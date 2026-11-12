import { join, resolve } from "node:path";
import type { Io } from "./cli.js";
import { type ConfigRead, readConfig } from "./config.js";
import { readsAnyConfig } from "./config-parse.js";
import { detectLanguages, type Language } from "./detect.js";
import { InputError } from "./errors.js";
import type { RecordedScan, Scan } from "./scan.js";
import {
  isDirty,
  readCachedScan,
  resolveCommit,
  runScanSync,
} from "./scan-command.js";

export interface FreshScans {
  scans: Scan[];
  scanned: boolean;
}

function readAll(
  io: Io,
  root: string,
  languages: Language[],
): RecordedScan[] | null {
  const scans = languages.map((language) => readCachedScan(io, root, language));

  return scans.every((scan) => scan !== null)
    ? (scans as RecordedScan[])
    : null;
}

function isReusable(
  io: Io,
  root: string,
  commit: string,
  scans: RecordedScan[],
): boolean {
  return scans.every(
    (scan) =>
      scan.commit === commit &&
      scan.modified === false &&
      scan.files.every(
        (file) => io.hashFile(join(root, file.path)) === file.hash,
      ),
  );
}

export type CachedScansState =
  | { state: "current"; scans: RecordedScan[] }
  | { state: "missing" }
  | { state: "stale" };

export function cachedScansState(
  io: Io,
  root: string,
  languages: Language[],
): CachedScansState {
  const cached = readAll(io, root, languages);

  if (cached === null) {
    return { state: "missing" };
  }

  const commit = resolveCommit(io, root);

  return commit !== null &&
    !isDirty(io, root) &&
    isReusable(io, root, commit, cached)
    ? { state: "current", scans: cached }
    : { state: "stale" };
}

export function freshScans(io: Io, root: string, read: ConfigRead): FreshScans {
  const directory = resolve(root);

  try {
    io.readDir(directory);
  } catch {
    throw new InputError([`repository is not a directory: ${directory}`]);
  }

  if (readsAnyConfig(read)) {
    readConfig(io, directory, read);
  }

  const detected = detectLanguages(io, directory);

  if (detected.length > 0) {
    const cached = cachedScansState(io, directory, detected);

    if (cached.state === "current") {
      return { scans: cached.scans, scanned: false };
    }
  }

  const status = runScanSync(
    [directory, "--extract"],
    {
      ...io,
      stdout: io.stderr,
    },
    read,
  );

  if (status !== 0) {
    throw new InputError([`recognizer scan failed in ${directory}`]);
  }

  const scans = readAll(io, directory, detected);

  if (scans === null || scans.length === 0) {
    throw new InputError([`recognizer scan wrote no scan for ${directory}`]);
  }

  return { scans, scanned: true };
}
