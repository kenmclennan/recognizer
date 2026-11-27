import { spawnSync } from "node:child_process";

function alive(pid) {
  const listed = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8",
  });
  const state = listed.stdout.trim();

  return state !== "" && !state.startsWith("Z");
}

function signal(pids, name) {
  for (const pid of pids) {
    try {
      process.kill(pid, name);
    } catch {}
  }
}

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function stopProcessesSync(
  pids,
  { graceMs = 15_000, stepMs = 50 } = {},
) {
  signal(pids, "SIGTERM");

  const limit = Date.now() + graceMs;
  let remaining = pids.filter(alive);

  while (remaining.length > 0 && Date.now() < limit) {
    pause(stepMs);
    remaining = remaining.filter(alive);
  }

  signal(remaining, "SIGKILL");

  return remaining.length === 0;
}
