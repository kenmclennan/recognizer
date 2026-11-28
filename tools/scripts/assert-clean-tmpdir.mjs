import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import { logForwardedSignal } from "./forwarded-signal-log.mjs";
import { removeScratch } from "./service-scratch-teardown.mjs";

const TOOL_OWNED = [/^node-compile-cache$/, /^uv-[0-9a-f]+\.lock$/];

const EMPTY_TOOL_DIRECTORY = /^pytest-of-/;

function isEmptyDirectory(path) {
  return statSync(path).isDirectory() && readdirSync(path).length === 0;
}

export function leftovers(directory) {
  return readdirSync(directory).filter(
    (entry) =>
      !TOOL_OWNED.some((pattern) => pattern.test(entry)) &&
      !(
        EMPTY_TOOL_DIRECTORY.test(entry) &&
        isEmptyDirectory(join(directory, entry))
      ),
  );
}

const FORWARDED = ["SIGINT", "SIGTERM", "SIGHUP"];

const STALE_SCRATCH = /^ac-(\d+)-/;

const SERVICE_SCRATCH = /^service-scratch-/;

async function removeServiceScratch(scratch, options) {
  for (const entry of readdirSync(scratch)) {
    if (SERVICE_SCRATCH.test(entry)) {
      await removeScratch(join(scratch, entry), options);
    }
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function sweepStale(options) {
  for (const entry of readdirSync(tmpdir())) {
    const match = STALE_SCRATCH.exec(entry);

    if (match !== null && !isAlive(Number(match[1]))) {
      await removeScratch(join(tmpdir(), entry), options);
    }
  }
}

function runChild(command, args, scratch) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      detached: true,
      env: { ...process.env, TMPDIR: scratch },
    });
    let received;
    let killTimer;
    const handlers = FORWARDED.map((name) => {
      const handler = () => {
        received ??= name;
        logForwardedSignal(name, child.pid);
        signalGroup(child.pid, name);
        killTimer ??= setTimeout(
          () => signalGroup(child.pid, "SIGKILL"),
          5_000,
        );
      };

      process.on(name, handler);

      return [name, handler];
    });
    const finish = (status) => {
      clearTimeout(killTimer);

      for (const [name, handler] of handlers) {
        process.off(name, handler);
      }

      resolve(status);
    };

    child.on("error", (error) => {
      console.error(`${command}: ${error.message}`);
      finish(1);
    });
    child.on("close", (code, signalName) => {
      const name = received ?? signalName;

      if (name !== null && name !== undefined) {
        finish(128 + constants.signals[name]);
      } else {
        finish(code ?? 1);
      }
    });
  });
}

function signalGroup(pid, name) {
  try {
    process.kill(-pid, name);
  } catch {}
}

export async function runWithCleanTmpdir(command, args, options = {}) {
  await sweepStale(options);

  const scratch = mkdtempSync(join(tmpdir(), `ac-${process.pid}-`));
  const childStatus = await runChild(command, args, scratch);
  await removeServiceScratch(scratch, options);

  const left = leftovers(scratch);
  const removed = await removeScratch(scratch, options);

  if (childStatus !== 0) {
    return { status: childStatus, left };
  }

  return { status: left.length > 0 || !removed ? 1 : 0, left };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...args] = process.argv.slice(2);
  const { status, left } = await runWithCleanTmpdir(command, args);

  if (left.length > 0) {
    console.error(
      `${command} ${args.join(" ")} left ${left.length} entries in TMPDIR:\n${left.join("\n")}`,
    );
  }

  process.exit(status);
}
