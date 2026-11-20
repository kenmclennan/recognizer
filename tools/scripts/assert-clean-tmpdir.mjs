import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

export function runWithCleanTmpdir(command, args) {
  const scratch = mkdtempSync(join(tmpdir(), "ac-"));
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, TMPDIR: scratch },
  });
  const left = leftovers(scratch);

  rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });

  if (result.status !== 0) {
    return { status: result.status ?? 1, left };
  }

  return { status: left.length > 0 ? 1 : 0, left };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...args] = process.argv.slice(2);
  const { status, left } = runWithCleanTmpdir(command, args);

  if (left.length > 0) {
    console.error(
      `${command} ${args.join(" ")} left ${left.length} entries in TMPDIR:\n${left.join("\n")}`,
    );
  }

  process.exit(status);
}
