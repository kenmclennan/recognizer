import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runWithCleanTmpdir } from "./assert-clean-tmpdir.mjs";
import { scaledTimeout } from "./pool-scale.mjs";
import { makeTempDir } from "./temp-dirs.mjs";

const wrapper = fileURLToPath(
  new URL("./assert-clean-tmpdir.mjs", import.meta.url),
);

const holder = `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "held-"));
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", env: process.env });
process.stdout.write("ready " + process.env.TMPDIR + " " + grandchild.pid + "\\n");
setInterval(() => {}, 1000);
`;

function startWrapper(source, tmp) {
  const child = spawn(
    process.execPath,
    [wrapper, process.execPath, "-e", source],
    {
      env: { ...process.env, TMPDIR: tmp },
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const ready = new Promise((resolve) => {
    let text = "";

    child.stdout.on("data", (chunk) => {
      text += chunk;

      const match = /ready (\S+) (\d+)\n/.exec(text);

      if (match) {
        resolve({ scratch: match[1], grandchild: Number(match[2]) });
      }
    });
  });
  const exited = new Promise((resolve) =>
    child.on("close", (code, name) => resolve({ code, name })),
  );

  return { child, ready, exited };
}

function isDead(pid) {
  try {
    process.kill(pid, 0);

    return false;
  } catch {
    return true;
  }
}

const node = (source) => [process.execPath, ["-e", source]];

describe("runWithCleanTmpdir", () => {
  it("fails and names a directory the command leaves in TMPDIR", async () => {
    const { status, left } = await runWithCleanTmpdir(
      ...node(
        "require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'leak-'))",
      ),
    );

    expect(status).toBe(1);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/^leak-/);
  });

  it("passes when the command removes what it made", async () => {
    const { status, left } = await runWithCleanTmpdir(
      ...node(
        "const fs = require('node:fs'); const d = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'tidy-')); fs.rmSync(d, { recursive: true })",
      ),
    );

    expect(status).toBe(0);
    expect(left).toEqual([]);
  });

  it("removes a service scratch folder the run's own teardown left behind", async () => {
    const { status, left } = await runWithCleanTmpdir(
      ...node(
        "const fs = require('node:fs'); const d = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'service-scratch-')); fs.writeFileSync(require('node:path').join(d, 'f'), 'x')",
      ),
    );

    expect(status).toBe(0);
    expect(left).toEqual([]);
  });

  it("keeps the command's own exit status when it fails", async () => {
    const { status } = await runWithCleanTmpdir(...node("process.exit(3)"));

    expect(status).toBe(3);
  });

  it("exits 128 plus the signal number when the command is killed by a signal", async () => {
    const { status } = await runWithCleanTmpdir(
      ...node("process.kill(process.pid, 'SIGTERM')"),
    );

    expect(status).toBe(143);
  });
});

describe("wrapper lifecycle", () => {
  it.each([
    ["SIGTERM", 143],
    ["SIGINT", 130],
    ["SIGHUP", 129],
  ])(
    "exits 128 plus the signal and removes the scratch after a signal (%s)",
    async (name, expected) => {
      const { child, ready, exited } = startWrapper(
        holder,
        makeTempDir("ac-signal-"),
      );
      const { scratch, grandchild } = await ready;

      expect(existsSync(scratch)).toBe(true);

      child.kill(name);

      const { code } = await exited;

      expect(code).toBe(expected);
      expect(existsSync(scratch)).toBe(false);
      expect(isDead(grandchild)).toBe(true);
    },
    scaledTimeout(30_000),
  );

  it(
    "stops a process the command left running",
    async () => {
      const source = `
const { spawn } = require("node:child_process");
const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore", env: process.env });
g.unref();
console.log("ready " + process.env.TMPDIR + " " + g.pid);
`;
      const { ready, exited } = startWrapper(source, makeTempDir("ac-orphan-"));
      const { scratch, grandchild } = await ready;
      const { code } = await exited;

      expect(code).toBe(0);
      expect(existsSync(scratch)).toBe(false);
      expect(isDead(grandchild)).toBe(true);
    },
    scaledTimeout(30_000),
  );

  it("sweeps scratch folders of dead wrappers", async () => {
    const tmp = makeTempDir("ac-sweep-");
    const gone = spawnSync(process.execPath, ["-e", ""]);
    const dead = join(tmp, `ac-${gone.pid}-x`);
    const alive = join(tmp, `ac-${process.pid}-y`);

    for (const folder of [dead, alive]) {
      mkdirSync(folder);
      writeFileSync(join(folder, "f"), "x");
    }

    const { exited } = startWrapper("", tmp);

    await exited;

    expect(existsSync(dead)).toBe(false);
    expect(existsSync(alive)).toBe(true);
  });
});
