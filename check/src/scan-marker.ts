import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Io } from "./cli.js";
import validate from "./generated/scan-marker-validator.js";

export const MARKER_FILE = "scan-running.json";
export const PROGRESS_FILE = "scan-running.progress.jsonl";
export const STARTED_BY_VARIABLE = "RECOGNIZER_STARTED_BY";
export const REFUSED_EXIT = 3;

export type MarkerOrigin = "cli" | "app";

export type ScanRunPhase =
  | "checking"
  | "refused"
  | "running"
  | "finished"
  | "failed"
  | "stopped";

export interface RunGap {
  id: string;
  line: string;
  needs: string[];
}

export interface RunFailure {
  sensor: string;
  reason: string;
}

export interface ScanRunRecord {
  version: 2;
  run_id: string;
  pid: number;
  pgid: number | null;
  started_at: string;
  started_by: MarkerOrigin;
  repository: string;
  sensors: string[];
  describe: boolean;
  phase: ScanRunPhase;
  ended_at: string | null;
  exit: number | null;
  gaps: RunGap[];
  failure: RunFailure | null;
}

export interface MarkerDetails {
  sensors: string[];
  describe: boolean;
}

export interface HeldMarker {
  append(line: string): void;
  running(): void;
  refused(gaps: RunGap[]): void;
  end(exit: number, failure: RunFailure | null): void;
  release(): void;
}

export type Acquired =
  | { ok: true; held: HeldMarker }
  | { ok: false; marker: ScanRunRecord; path: string };

const STOPPED_BY_SIGNAL = 143;

const held = new Set<HeldMarker>();
const stops = new Map<HeldMarker, (exit: number) => void>();

export function markerPath(root: string): string {
  return join(root, ".recognizer", "cache", MARKER_FILE);
}

export function progressPath(root: string): string {
  return join(root, ".recognizer", "cache", PROGRESS_FILE);
}

export function parseMarker(text: string): ScanRunRecord | null {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  return validate(value) ? (value as unknown as ScanRunRecord) : null;
}

export function markerOrigin(io: Io): MarkerOrigin {
  return io.env(STARTED_BY_VARIABLE) === "app" ? "app" : "cli";
}

export function refusalText(marker: ScanRunRecord, path: string): string {
  const who = marker.started_by === "app" ? "the app" : "the command line";

  return `a scan is already running on ${marker.repository}: started from ${who} at ${marker.started_at}, process ${marker.pid}; remove ${path} if that process is not a scan\n`;
}

function readMarker(io: Io, path: string): ScanRunRecord | null {
  try {
    return parseMarker(io.readFile(path));
  } catch {
    return null;
  }
}

function liveOwner(io: Io, path: string): ScanRunRecord | null {
  if (!io.exists(path)) {
    return null;
  }

  const marker = readMarker(io, path);

  return marker !== null &&
    (marker.phase === "checking" || marker.phase === "running") &&
    io.pidAlive(marker.pid)
    ? marker
    : null;
}

export function acquireMarker(
  io: Io,
  root: string,
  details: MarkerDetails,
): Acquired {
  const path = markerPath(root);
  const progress = progressPath(root);
  let record: ScanRunRecord = {
    version: 2,
    run_id: randomUUID(),
    pid: io.pid(),
    pgid: io.processGroup(io.pid()),
    started_at: new Date(io.now()).toISOString(),
    started_by: markerOrigin(io),
    repository: root,
    sensors: details.sensors,
    describe: details.describe,
    phase: "checking",
    ended_at: null,
    exit: null,
    gaps: [],
    failure: null,
  };
  const content = `${JSON.stringify(record, null, 2)}\n`;

  const refused = (): Acquired | null => {
    const owner = liveOwner(io, path);

    return owner === null ? null : { ok: false, marker: owner, path };
  };

  if (!io.createExclusive(path, content)) {
    const owner = refused();

    if (owner !== null) {
      return owner;
    }

    io.remove(progress);
    io.remove(path);

    if (!io.createExclusive(path, content)) {
      const raced = refused();

      if (raced !== null) {
        return raced;
      }

      throw new Error(`cannot take the scan marker ${path}`);
    }
  }

  io.writeFile(progress, "");

  const holdsRecord = (): boolean => {
    const current = readMarker(io, path);

    return current !== null && current.pid === record.pid;
  };

  const write = (changes: Partial<ScanRunRecord>) => {
    record = { ...record, ...changes };

    const temporary = `${path}.${record.pid}.tmp`;

    io.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
    io.rename(temporary, path);
  };

  const active = (): boolean =>
    (record.phase === "checking" || record.phase === "running") &&
    holdsRecord();

  const ended = (): string => new Date(io.now()).toISOString();

  const handle: HeldMarker = {
    append: (line) => io.append(progress, line),
    running: () => {
      if (active()) {
        write({ phase: "running" });
      }
    },
    refused: (gaps) => {
      if (active()) {
        write({ phase: "refused", gaps, ended_at: ended(), exit: 4 });
      }
    },
    end: (exit, failure) => {
      if (active()) {
        write(
          failure === null && exit === 0
            ? { phase: "finished", ended_at: ended(), exit }
            : { phase: "failed", ended_at: ended(), exit, failure },
        );
      }
    },
    release: () => {
      held.delete(handle);

      if (active()) {
        write({
          phase: "failed",
          ended_at: ended(),
          exit: 1,
          failure: { sensor: "scan", reason: "the scan ended on an error" },
        });
      }
    },
  };

  stops.set(handle, (exit) => {
    if (active()) {
      write({ phase: "stopped", ended_at: ended(), exit });
    }
  });

  held.add(handle);

  return { ok: true, held: handle };
}

export function releaseHeldMarkers(exit: number = STOPPED_BY_SIGNAL): void {
  for (const one of [...held]) {
    stops.get(one)?.(exit);
    one.release();
  }
}
