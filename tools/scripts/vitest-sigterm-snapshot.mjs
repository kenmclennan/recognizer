import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SNAPSHOT_DIRECTORY_VARIABLE = "RECOGNIZER_SIGTERM_SNAPSHOT_DIR";

const INSTALLED = Symbol.for("recognizer.sigtermSnapshot");

export function buildSnapshot({ now, pid, ppid, pgid, processTable }) {
  return [
    `time ${now}`,
    `worker pid ${pid} ppid ${ppid} pgid ${pgid}`,
    "ps -ww -E -A -o pid,ppid,pgid,etime,command:",
    processTable,
    "",
  ].join("\n");
}

function readPgid(pid) {
  const result = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], {
    encoding: "utf8",
  });

  return Number(result.stdout);
}

function readProcessTable() {
  const result = spawnSync(
    "ps",
    ["-ww", "-E", "-A", "-o", "pid,ppid,pgid,etime,command"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );

  return typeof result.stdout === "string" ? result.stdout : "";
}

export function writeSnapshot(directory) {
  mkdirSync(directory, { recursive: true });

  writeFileSync(
    join(directory, `sigterm-${process.pid}.txt`),
    buildSnapshot({
      now: new Date().toISOString(),
      pid: process.pid,
      ppid: process.ppid,
      pgid: readPgid(process.pid),
      processTable: readProcessTable(),
    }),
  );
}

export function installSigtermSnapshot(
  directory = process.env[SNAPSHOT_DIRECTORY_VARIABLE],
) {
  if (!directory || process[INSTALLED]) {
    return;
  }

  process[INSTALLED] = true;

  const handler = () => {
    try {
      writeSnapshot(directory);
    } catch {}

    if (process.listenerCount("SIGTERM") > 1) {
      return;
    }

    process.removeListener("SIGTERM", handler);
    process.kill(process.pid, "SIGTERM");
  };

  process.on("SIGTERM", handler);
}

installSigtermSnapshot();
