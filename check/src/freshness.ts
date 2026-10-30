import { join, resolve } from "node:path";
import type { Io } from "./cli.js";
import { detectLanguages, type Language } from "./detect.js";
import { InputError } from "./errors.js";
import { type RecordedScan, type Scan, validateScan } from "./scan.js";
import { cacheFile, isDirty, resolveCommit, runScan } from "./scan-command.js";

export interface FreshScans {
  scans: Scan[];
  scanned: boolean;
}

function readCache(
  io: Io,
  root: string,
  language: Language,
): RecordedScan | null {
  try {
    return validateScan(
      JSON.parse(io.readFile(cacheFile(root, language))),
    ) as RecordedScan;
  } catch {
    return null;
  }
}

function readAll(
  io: Io,
  root: string,
  languages: Language[],
): RecordedScan[] | null {
  const scans = languages.map((language) => readCache(io, root, language));

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

export function freshScans(io: Io, root: string): FreshScans {
  const directory = resolve(root);

  try {
    io.readDir(directory);
  } catch {
    throw new InputError([`repository is not a directory: ${directory}`]);
  }

  const commit = resolveCommit(io, directory);
  const detected = detectLanguages(io, directory);

  if (commit !== null && detected.length > 0 && !isDirty(io, directory)) {
    const cached = readAll(io, directory, detected);

    if (cached !== null && isReusable(io, directory, commit, cached)) {
      return { scans: cached, scanned: false };
    }
  }

  const status = runScan([directory], { ...io, stdout: io.stderr });

  if (status !== 0) {
    throw new InputError([`recognizer scan failed in ${directory}`]);
  }

  const scans = readAll(io, directory, detected);

  if (scans === null || scans.length === 0) {
    throw new InputError([`recognizer scan wrote no scan for ${directory}`]);
  }

  return { scans, scanned: true };
}
