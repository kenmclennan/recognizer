import type { Io } from "../cli.js";
import { readRun, type ScanRunRecord } from "../scan-marker.js";
import type { StopBackstops } from "./stop-backstops.js";
import { isActive } from "./watch.js";

export const SIGNAL_BACKSTOP_MS = 15_000;
export const BACKSTOP_CHECK_MS = 250;

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
      setTimeout(action, ms);
    },
  };
}

export function stopMarkerProcess(
  io: Io,
  repository: string,
  owner: StopOwner,
  signals: Signals,
  backstopMs: number = SIGNAL_BACKSTOP_MS,
  backstops?: StopBackstops,
): void {
  const run: ScanRunRecord | null = readRun(io, repository);

  if (run === null || !isActive(run) || run.pid === io.pid()) {
    return;
  }

  if (owner === "app" && run.started_by !== "app") {
    return;
  }

  if (run.started_by === "app" || run.pgid === run.pid) {
    if (!leadsOwnGroup(io, run)) {
      return;
    }

    signals.signal(run.pid, true, "SIGTERM");
    holdBackstop(io, repository, run, signals, backstopMs, backstops);

    return;
  }

  signals.signal(run.pid, false, "SIGTERM");
}

function leadsOwnGroup(io: Io, run: ScanRunRecord): boolean {
  const group = io.processGroup(run.pid);

  if (group === null) {
    return true;
  }

  return group === run.pid && group !== io.processGroup(io.pid());
}

function holdBackstop(
  io: Io,
  repository: string,
  run: ScanRunRecord,
  signals: Signals,
  backstopMs: number,
  backstops: StopBackstops | undefined,
): void {
  const release = backstops?.begin() ?? (() => {});
  let waited = 0;

  const check = () => {
    const now = readRun(io, repository);

    if (now === null || !isActive(now) || now.run_id !== run.run_id) {
      release();

      return;
    }

    if (waited >= backstopMs) {
      if (leadsOwnGroup(io, run)) {
        signals.signal(run.pid, true, "SIGKILL");
      }

      release();

      return;
    }

    const next = Math.min(BACKSTOP_CHECK_MS, backstopMs - waited);

    waited += next;
    signals.later(next, check);
  };

  const first = Math.min(BACKSTOP_CHECK_MS, backstopMs);

  waited += first;
  signals.later(first, check);
}
