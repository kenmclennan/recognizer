import { join, resolve } from "node:path";
import { Repository } from "@recognizer/core";
import type { Io } from "./cli.js";
import { type ConfigRead, readConfig } from "./config.js";
import { readsAnyConfig } from "./config-parse.js";
import { detectLanguages, type Language } from "./detect.js";
import { InputError } from "./errors.js";
import { discoverPlugins } from "./plugin-discovery.js";
import {
  dirtyPaths,
  readCachedRepository,
  resolveCommit,
  runScanSync,
} from "./scan-command.js";
import { languageRulesOf } from "./scanners.js";

export interface FreshScans {
  repository: Repository;
  scanned: boolean;
}

function readAll(
  io: Io,
  root: string,
  languages: Language[],
): Repository | null {
  const parts = languages.map((language) =>
    readCachedRepository(io, root, language),
  );

  return parts.every((part) => part !== null)
    ? Repository.join(parts as Repository[])
    : null;
}

function isReusable(
  io: Io,
  root: string,
  commit: string,
  repository: Repository,
): boolean {
  return repository.extractions.every(
    (extraction) =>
      extraction.commit === commit &&
      extraction.modified === false &&
      extraction.files.every(
        (file) => io.hashFile(join(root, file.path)) === file.hash,
      ),
  );
}

export type CachedScansState =
  | { state: "current"; repository: Repository }
  | { state: "missing" }
  | { state: "stale"; reason: "uncommitted"; paths: string[] }
  | { state: "stale"; reason: "scan" };

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

  if (commit === null) {
    return { state: "stale", reason: "scan" };
  }

  const dirty = dirtyPaths(io, root);

  if (dirty !== null && dirty.length > 0) {
    return { state: "stale", reason: "uncommitted", paths: dirty };
  }

  return dirty !== null && isReusable(io, root, commit, cached)
    ? { state: "current", repository: cached }
    : { state: "stale", reason: "scan" };
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

  const detected = detectLanguages(
    io,
    directory,
    languageRulesOf(discoverPlugins(io, ["scanner"]).plugins),
  );

  if (detected.length > 0) {
    const cached = cachedScansState(io, directory, detected);

    if (cached.state === "current") {
      return { repository: cached.repository, scanned: false };
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

  const repository = readAll(io, directory, detected);

  if (repository === null || repository.extractions.length === 0) {
    throw new InputError([`recognizer scan wrote no scan for ${directory}`]);
  }

  return { repository, scanned: true };
}
