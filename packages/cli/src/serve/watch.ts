import type { Io } from "../cli.js";
import { progressPath, readRun, type ScanRunRecord } from "../scan-marker.js";

export const ACTIVE_POLL_MS = 250;
export const IDLE_POLL_MS = 1000;

export type WatchItem = { run: ScanRunRecord | null } | { line: string };

export interface WatchState {
  run: ScanRunRecord | null;
  announced: boolean;
  offset: number;
}

export function newWatchState(): WatchState {
  return { run: null, announced: false, offset: 0 };
}

export function isActive(run: ScanRunRecord | null): boolean {
  return run !== null && (run.phase === "checking" || run.phase === "running");
}

export function pollInterval(state: WatchState): number {
  return isActive(state.run) ? ACTIVE_POLL_MS : IDLE_POLL_MS;
}

function appendedLines(
  io: Io,
  root: string,
  offset: number,
): { lines: string[]; offset: number } {
  const path = progressPath(root);

  if (!io.exists(path)) {
    return { lines: [], offset };
  }

  let bytes: Buffer;

  try {
    bytes = io.readBytes(path);
  } catch {
    return { lines: [], offset };
  }

  const from = bytes.length < offset ? 0 : offset;
  const tail = bytes.subarray(from);
  const end = tail.lastIndexOf(0x0a);

  if (end === -1) {
    return { lines: [], offset: from };
  }

  const lines = tail
    .subarray(0, end)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");

  return { lines, offset: from + end + 1 };
}

export function watchTick(
  io: Io,
  root: string,
  state: WatchState,
): WatchItem[] {
  const run = readRun(io, root);
  const out: WatchItem[] = [];

  if (run === null) {
    if (state.run !== null || !state.announced) {
      out.push({ run: null });
    }

    state.run = null;
    state.announced = true;
    state.offset = 0;

    return out;
  }

  const fresh = state.run?.run_id !== run.run_id;

  if (fresh) {
    state.offset = 0;
  }

  const changed = JSON.stringify(state.run) !== JSON.stringify(run);
  const active = isActive(run);
  const read = appendedLines(io, root, state.offset);
  const lines = fresh && !active ? [] : read.lines;

  state.offset = read.offset;

  if (changed && active) {
    out.push({ run });
  }

  out.push(...lines.map((line) => ({ line })));

  if (changed && !active) {
    out.push({ run });
  }

  state.run = run;
  state.announced = true;

  return out;
}
