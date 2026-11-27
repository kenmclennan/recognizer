import type { ChildProcess } from "node:child_process";

export function signalGroup(
  child: ChildProcess,
  signal: NodeJS.Signals,
): boolean {
  if (
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return false;
  }

  process.kill(-child.pid, signal);

  return true;
}
