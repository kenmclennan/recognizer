import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SNAPSHOT_DIRECTORY_VARIABLE = "RECOGNIZER_SIGTERM_SNAPSHOT_DIR";

export function buildForwardRecord({
  now,
  signal,
  pid,
  ppid,
  pgid,
  childPid,
  processTable,
}) {
  return [
    `time ${now}`,
    `wrapper forwarded ${signal} to group -${childPid}`,
    `wrapper pid ${pid} ppid ${ppid} pgid ${pgid}`,
    "ps -ww -A -o pid,ppid,pgid,etime,command:",
    processTable,
    "",
  ].join("\n");
}

function readPs(columns) {
  const result = spawnSync("ps", ["-ww", ...columns], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  return typeof result.stdout === "string" ? result.stdout : "";
}

export function logForwardedSignal(
  signal,
  childPid,
  directory = process.env[SNAPSHOT_DIRECTORY_VARIABLE],
) {
  if (!directory) {
    return;
  }

  try {
    mkdirSync(directory, { recursive: true });

    writeFileSync(
      join(directory, `forwarded-${process.pid}-${signal}.txt`),
      buildForwardRecord({
        now: new Date().toISOString(),
        signal,
        pid: process.pid,
        ppid: process.ppid,
        pgid: Number(readPs(["-o", "pgid=", "-p", String(process.pid)])),
        childPid,
        processTable: readPs(["-A", "-o", "pid,ppid,pgid,etime,command"]),
      }),
    );
  } catch {}
}
