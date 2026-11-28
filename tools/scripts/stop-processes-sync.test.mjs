import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { stopProcessesSync } from "./stop-processes-sync.mjs";

function alive(pid) {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

async function started(body) {
  const child = spawn(process.execPath, ["-e", body], { stdio: "ignore" });

  await new Promise((resolve) => setTimeout(resolve, 300));

  return child;
}

describe("stopProcessesSync", () => {
  it("returns true once a process that exits on SIGTERM is gone", async () => {
    const child = await started("setInterval(() => {}, 1000)");
    const exited = new Promise((resolve) => child.once("exit", resolve));

    const clean = stopProcessesSync([child.pid], { graceMs: 5_000 });

    await exited;

    expect(clean).toBe(true);
    expect(alive(child.pid)).toBe(false);
  });

  it("kills a process that ignores SIGTERM once the grace ends and reports it", async () => {
    const child = await started(
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
    );
    const exited = new Promise((resolve) => child.once("exit", resolve));

    const clean = stopProcessesSync([child.pid], { graceMs: 300 });

    await exited;

    expect(clean).toBe(false);
    expect(alive(child.pid)).toBe(false);
  });

  it("never signals a process whose command is a vitest worker", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "setInterval(() => {}, 1000)",
        "/r/node_modules/vitest/dist/workers/forks.js",
      ],
      { stdio: "ignore" },
    );

    await new Promise((resolve) => setTimeout(resolve, 300));

    const clean = stopProcessesSync([child.pid], { graceMs: 200 });
    const stillAlive = alive(child.pid);

    child.kill("SIGKILL");

    expect(clean).toBe(true);
    expect(stillAlive).toBe(true);
  });

  it("accepts a process that is already gone", () => {
    expect(stopProcessesSync([2 ** 22 - 1], { graceMs: 200 })).toBe(true);
  });
});
