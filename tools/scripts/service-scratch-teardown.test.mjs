import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { removeScratch, writersIn } from "./service-scratch-teardown.mjs";

const WRITER = `
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[1];
process.on("SIGTERM", () => process.exit(0));
let n = 0;
setInterval(() => {
  try { fs.writeFileSync(path.join(dir, "late-" + n++), "x"); } catch {}
}, 5);
`;

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "teardown-scratch-"));

  writeFileSync(join(dir, "seed"), "");

  return dir;
}

async function startWriter(dir) {
  const child = spawn(process.execPath, ["-e", WRITER, dir], {
    env: { ...process.env, TMPDIR: dir },
    stdio: "ignore",
  });

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
});

describe("writersIn", () => {
  const listing = [
    "101 /usr/bin/node A=1 TMPDIR=/s/a B=2",
    "102 /usr/bin/node TMPDIR=/s/ab B=2",
    "103 /usr/bin/node A=1 B=2",
    "104 /usr/bin/node A=1 TMPDIR=/s/a",
  ].join("\n");

  it("returns only pids whose environment carries the exact marker", () => {
    expect(writersIn("/s/a", listing)).toEqual([101, 104]);
  });

  it("returns nothing for an empty listing", () => {
    expect(writersIn("/s/a", "")).toEqual([]);
  });
});
