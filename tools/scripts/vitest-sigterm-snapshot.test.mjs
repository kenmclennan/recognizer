import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./temp-dirs.mjs";
import {
  buildSnapshot,
  SNAPSHOT_DIRECTORY_VARIABLE,
} from "./vitest-sigterm-snapshot.mjs";

const MODULE = fileURLToPath(
  new URL("./vitest-sigterm-snapshot.mjs", import.meta.url),
);

function killedWorker(directory, source) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import ${JSON.stringify(MODULE)};${source}`,
      ],
      {
        env: { ...process.env, [SNAPSHOT_DIRECTORY_VARIABLE]: directory },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );

    child.stdout.once("data", () => child.kill("SIGTERM"));
    child.on("exit", (code, signal) =>
      resolve({ code, signal, pid: child.pid }),
    );
  });
}

describe("vitest sigterm snapshot", () => {
  it("states the worker's pid, ppid and pgid above the process table", () => {
    const text = buildSnapshot({
      now: "t",
      pid: 7,
      ppid: 3,
      pgid: 5,
      processTable: "TABLE",
    });

    expect(text).toContain("worker pid 7 ppid 3 pgid 5");
    expect(text.indexOf("worker pid")).toBeLessThan(text.indexOf("TABLE"));
  });

  it("writes a snapshot file and still ends the worker by SIGTERM", async () => {
    const directory = makeTempDir("sigterm-snapshot-");

    const outcome = await killedWorker(
      directory,
      "process.stdout.write('ready');setInterval(()=>{},1000);",
    );

    expect(outcome.signal).toBe("SIGTERM");

    const files = readdirSync(directory);

    expect(files).toEqual([`sigterm-${outcome.pid}.txt`]);
    expect(readFileSync(join(directory, files[0]), "utf8")).toContain(
      `worker pid ${outcome.pid}`,
    );
  });

  it("leaves a worker that handles SIGTERM itself to its own exit code", async () => {
    const directory = makeTempDir("sigterm-snapshot-");

    const outcome = await killedWorker(
      directory,
      "process.on('SIGTERM',()=>process.exit(3));process.stdout.write('ready');setInterval(()=>{},1000);",
    );

    expect(outcome.code).toBe(3);
    expect(readdirSync(directory)).toHaveLength(1);
  });

  it("does nothing when no directory is configured", async () => {
    const directory = makeTempDir("sigterm-snapshot-");

    const outcome = await killedWorker(
      "",
      "process.stdout.write('ready');setInterval(()=>{},1000);",
    );

    expect(outcome.signal).toBe("SIGTERM");
    expect(readdirSync(directory)).toEqual([]);
  });
});
