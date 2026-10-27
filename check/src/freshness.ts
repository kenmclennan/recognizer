import { resolve } from "node:path";
import type { Io } from "./cli.js";
import { detectLanguages, type Language } from "./detect.js";
import { InputError } from "./errors.js";
import { type Scan, validateScan } from "./scan.js";
import { cacheFile, resolveCommit, runScan } from "./scan-command.js";

export interface FreshScans {
  scans: Scan[];
  scanned: boolean;
}

function isDirty(io: Io, root: string): boolean {
  const result = io.run("git", [
    "-C",
    root,
    "status",
    "--porcelain",
    "--",
    ".",
    ":!.recognizer",
  ]);

  return !result.started || result.status !== 0 || result.stdout.trim() !== "";
}

function readCache(
  io: Io,
  root: string,
  language: Language,
): (Scan & { commit?: string | null }) | null {
  try {
    return validateScan(JSON.parse(io.readFile(cacheFile(root, language))));
  } catch {
    return null;
  }
}

function readAll(
  io: Io,
  root: string,
  languages: Language[],
): (Scan & { commit?: string | null })[] | null {
  const scans = languages.map((language) => readCache(io, root, language));

  return scans.every((scan) => scan !== null)
    ? (scans as (Scan & { commit?: string | null })[])
    : null;
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

    if (cached?.every((scan) => scan.commit === commit)) {
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
