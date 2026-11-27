import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const REMOVAL_ERRORS = new Set(["ENOTEMPTY", "EBUSY", "EPERM", "EACCES"]);

function tryRemove(scratch) {
  try {
    rmSync(scratch, { recursive: true, force: true });

    return undefined;
  } catch (error) {
    if (REMOVAL_ERRORS.has(error.code)) {
      return error;
    }

    throw error;
  }
}

export function writersIn(scratch) {
  const result = spawnSync("ps", ["eww", "-A", "-o", "pid=,command="], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  if (result.error !== undefined || typeof result.stdout !== "string") {
    return [];
  }

  const marker = `TMPDIR=${scratch}`;

  return result.stdout
    .split("\n")
    .filter((line) => {
      const at = line.indexOf(marker);

      return at !== -1 && [" ", undefined].includes(line[at + marker.length]);
    })
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function signal(pids, name) {
  for (const pid of pids) {
    try {
      process.kill(pid, name);
    } catch {}
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stopWriters(scratch, name, ms, stepMs) {
  const limit = Date.now() + ms;
  let writers = writersIn(scratch);

  while (writers.length > 0 && Date.now() < limit) {
    signal(writers, name);
    await pause(stepMs);
    writers = writersIn(scratch);
  }

  return writers;
}

export async function removeScratch(scratch, options = {}) {
  const { graceMs = 5_000, killMs = 5_000, stepMs = 100 } = options;
  const warn = options.warn ?? console.warn;

  let writers = await stopWriters(scratch, "SIGTERM", graceMs, stepMs);

  if (writers.length > 0) {
    writers = await stopWriters(scratch, "SIGKILL", killMs, stepMs);
  }

  let failure = tryRemove(scratch);

  for (let attempt = 0; failure !== undefined && attempt < 20; attempt++) {
    await pause(stepMs);
    failure = tryRemove(scratch);
  }

  if (failure === undefined) {
    return true;
  }

  warn(
    `service scratch ${scratch} was not removed: ${failure.code}; writers still running: ${writers.join(", ") || "none"}`,
  );

  return false;
}
