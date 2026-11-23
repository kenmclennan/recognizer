import { join, resolve } from "node:path";
import { freshScansOver, Repository } from "@recognizer/core";
import type { Io } from "./cli.js";
import type { ConfigRead } from "./config.js";
import type { Language } from "./detect.js";
import { asInputError } from "./errors.js";
import { freshPorts } from "./fresh-ports.js";
import {
  dirtyPaths,
  readCachedRepository,
  resolveCommit,
} from "./scan-command.js";
import { requestFrom } from "./scan-main.js";

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

  return asInputError(() =>
    freshScansOver(
      freshPorts(io, read),
      { scan: requestFrom([directory, "--extract"], io).request },
      directory,
    ),
  );
}
