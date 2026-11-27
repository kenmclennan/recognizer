import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { removeScratch, writersIn } from "./service-scratch-teardown.mjs";
import { makeTempDir } from "./temp-dirs.mjs";

const WRITER = `
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[1];
const lifetimeMs = Number(process.argv[2]);
const parent = process.ppid;
const born = Date.now();
process.on("SIGTERM", () => process.exit(0));
let n = 0;
setInterval(() => {
  if (!fs.existsSync(dir) || process.ppid !== parent || Date.now() - born > lifetimeMs) process.exit(0);
  try { fs.writeFileSync(path.join(dir, "late-" + n++), "x"); } catch {}
}, 5);
`;

const WRITER_LIFETIME_MS = 5_000;
const LONG_LIFETIME_MS = 60_000;
const REMOVE = {
  recursive: true,
  force: true,
  maxRetries: 20,
  retryDelay: 25,
};

function alive(pid) {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

async function waitUntil(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) return true;

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return condition();
}

function scratch() {
  const dir = makeTempDir("teardown-scratch-");

  writeFileSync(join(dir, "seed"), "");

  return dir;
}

async function startWriter(dir, lifetimeMs = WRITER_LIFETIME_MS) {
  const child = spawn(
    process.execPath,
    ["-e", WRITER, dir, String(lifetimeMs)],
    {
      env: { ...process.env, TMPDIR: dir },
      stdio: "ignore",
    },
  );

  const exited = new Promise((resolve) => child.on("exit", resolve));

  while (!existsSync(join(dir, "late-1"))) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return { child, exited };
}

describe("removeScratch", () => {
  it("removes a folder nothing writes into", async () => {
    const dir = scratch();

    expect(await removeScratch(dir)).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it("stops a process still writing into the folder before removing it", async () => {
    const dir = scratch();
    const { exited } = await startWriter(dir);

    expect(await removeScratch(dir)).toBe(true);
    expect(existsSync(dir)).toBe(false);

    await exited;
  });

  it("kills a writer that ignores the first signal", async () => {
    const dir = scratch();
    const { child, exited } = await startWriter(dir);

    child.kill("SIGSTOP");

    const result = await removeScratch(dir, { graceMs: 200, killMs: 5_000 });

    child.kill("SIGCONT");
    await exited;

    expect(result).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it("ends a writer by itself once its folder is gone", async () => {
    const dir = scratch();
    const { child, exited } = await startWriter(dir, LONG_LIFETIME_MS);

    try {
      rmSync(dir, REMOVE);

      expect(await waitUntil(() => !alive(child.pid), 3_000)).toBe(true);
    } finally {
      child.kill("SIGKILL");
      await exited;
    }
  });

  it("ends a writer by itself after its lifetime", async () => {
    const dir = scratch();
    const { child, exited } = await startWriter(dir, 300);

    try {
      expect(await waitUntil(() => !alive(child.pid), 3_000)).toBe(true);
    } finally {
      child.kill("SIGKILL");
      await exited;
      rmSync(dir, REMOVE);
    }
  });

  it("ends a writer by itself when its parent is killed", async () => {
    const dir = scratch();
    const parent = spawn(
      process.execPath,
      [
        "-e",
        `const { spawn } = require("node:child_process");
const w = spawn(process.execPath, ["-e", ${JSON.stringify(WRITER)}, process.argv[1], process.argv[2]], { stdio: "ignore" });
console.log(w.pid);
setInterval(() => {}, 1000);`,
        dir,
        String(LONG_LIFETIME_MS),
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );

    let writerPid = 0;

    try {
      writerPid = await new Promise((resolve) =>
        parent.stdout.once("data", (chunk) =>
          resolve(Number(String(chunk).trim())),
        ),
      );

      expect(
        await waitUntil(() => existsSync(join(dir, "late-1")), 3_000),
      ).toBe(true);
      expect(alive(writerPid)).toBe(true);

      parent.kill("SIGKILL");

      expect(await waitUntil(() => !alive(writerPid), 3_000)).toBe(true);
    } finally {
      parent.kill("SIGKILL");

      if (writerPid && alive(writerPid)) process.kill(writerPid, "SIGKILL");

      rmSync(dir, REMOVE);
    }
  });
});

describe("writersIn", () => {
  const listing = [
    "101 /usr/bin/node A=1 TMPDIR=/s/a B=2",
    "102 /usr/bin/node TMPDIR=/s/ab B=2",
    "103 /usr/bin/node A=1 B=2",
    "104 /usr/bin/node A=1 TMPDIR=/s/a",
    "105 /usr/bin/node A=1 TMPDIR=/s/a/serve-tmp-x B=2",
  ].join("\n");

  it("returns pids whose TMPDIR is the folder or a folder inside it, never a sibling sharing its prefix", () => {
    expect(writersIn("/s/a", listing)).toEqual([101, 104, 105]);
  });

  it("returns nothing for an empty listing", () => {
    expect(writersIn("/s/a", "")).toEqual([]);
  });
});
