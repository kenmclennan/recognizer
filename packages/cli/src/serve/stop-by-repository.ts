import type { Io } from "../cli.js";
import { readRun, type ScanRunRecord } from "../scan-marker.js";
import { isActive } from "./watch.js";

export const SIGNAL_BACKSTOP_MS = 15_000;

export type StopOwner = "any" | "app";

export interface Signals {
  signal(pid: number, group: boolean, name: "SIGTERM" | "SIGKILL"): void;
  later(ms: number, action: () => void): void;
}

export function systemSignals(): Signals {
  return {
    signal: (pid, group, name) => {
      try {
        process.kill(group ? -pid : pid, name);
      } catch {}
    },
    later: (ms, action) => {
      setTimeout(action, ms).unref();
    },
  };
}

export function stopMarkerProcess(
  io: Io,
  repository: string,
  owner: StopOwner,
  signals: Signals,
  backstopMs: number = SIGNAL_BACKSTOP_MS,
): void {
  const run: ScanRunRecord | null = readRun(io, repository);

  if (run === null || !isActive(run) || run.pid === io.pid()) {
    return;
  }

  if (owner === "app" && run.started_by !== "app") {
    return;
  }

  if (run.started_by === "app" || run.pgid === run.pid) {
    signals.signal(run.pid, true, "SIGTERM");
    signals.later(backstopMs, () => signals.signal(run.pid, true, "SIGKILL"));

    return;
  }

  signals.signal(run.pid, false, "SIGTERM");
}
