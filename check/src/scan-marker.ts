import { join } from "node:path";
import type { Io } from "./cli.js";
import validate from "./generated/scan-marker-validator.js";

export const MARKER_FILE = "scan-running.json";
export const PROGRESS_FILE = "scan-running.progress.jsonl";
export const STARTED_BY_VARIABLE = "RECOGNIZER_STARTED_BY";
export const REFUSED_EXIT = 3;

export type MarkerOrigin = "cli" | "app";

export interface ScanMarker {
  version: 1;
  pid: number;
  started_at: string;
  started_by: MarkerOrigin;
  repository: string;
  sensors: string[];
  describe: boolean;
}

export interface MarkerDetails {
  sensors: string[];
  describe: boolean;
}

export interface HeldMarker {
  append(line: string): void;
  release(): void;
}

export type Acquired =
  | { ok: true; held: HeldMarker }
  | { ok: false; marker: ScanMarker; path: string };

const held = new Set<HeldMarker>();

export function markerPath(root: string): string {
  return join(root, ".recognizer", "cache", MARKER_FILE);
}

export function progressPath(root: string): string {
  return join(root, ".recognizer", "cache", PROGRESS_FILE);
}

export function parseMarker(text: string): ScanMarker | null {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  return validate(value) ? (value as unknown as ScanMarker) : null;
}

export function markerOrigin(io: Io): MarkerOrigin {
  return io.env(STARTED_BY_VARIABLE) === "app" ? "app" : "cli";
}

export function refusalText(marker: ScanMarker, path: string): string {
  const who = marker.started_by === "app" ? "the app" : "the command line";

  return `a scan is already running on ${marker.repository}: started from ${who} at ${marker.started_at}, process ${marker.pid}; remove ${path} if that process is not a scan\n`;
}

function readMarker(io: Io, path: string): ScanMarker | null {
  try {
    return parseMarker(io.readFile(path));
  } catch {
    return null;
  }
}

function liveOwner(io: Io, path: string): ScanMarker | null {
  if (!io.exists(path)) {
    return null;
  }

  const marker = readMarker(io, path);

  return marker !== null && io.pidAlive(marker.pid) ? marker : null;
}

export function acquireMarker(
  io: Io,
  root: string,
  details: MarkerDetails,
): Acquired {
  const path = markerPath(root);
  const progress = progressPath(root);
  const marker: ScanMarker = {
    version: 1,
    pid: io.pid(),
    started_at: new Date(io.now()).toISOString(),
    started_by: markerOrigin(io),
    repository: root,
    sensors: details.sensors,
    describe: details.describe,
  };
  const content = `${JSON.stringify(marker, null, 2)}\n`;

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

  const handle: HeldMarker = {
    append: (line) => io.append(progress, line),
    release: () => {
      held.delete(handle);

      const current = readMarker(io, path);

      if (current !== null && current.pid === marker.pid) {
        io.remove(progress);
        io.remove(path);
      }
    },
  };

  held.add(handle);

  return { ok: true, held: handle };
}

export function releaseHeldMarkers(): void {
  for (const one of [...held]) {
    one.release();
  }
}
