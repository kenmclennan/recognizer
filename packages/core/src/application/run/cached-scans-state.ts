import { Repository } from "../../domain/repository.js";
import { extractionsReusable } from "../../domain/scan-reuse.js";

export type CachedScansState =
  | { state: "current"; repository: Repository }
  | { state: "missing" }
  | { state: "stale"; reason: "uncommitted"; paths: string[] }
  | { state: "stale"; reason: "scan" };

export interface CachedScansSources {
  readCached(language: string): Repository | null;
  commit(): string | null;
  dirtyPaths(): readonly string[] | null;
  hashOf(path: string): string | null;
}

export function cachedScansState(
  sources: CachedScansSources,
  languages: readonly string[],
): CachedScansState {
  const parts = languages.map((language) => sources.readCached(language));

  if (!parts.every((part) => part !== null)) {
    return { state: "missing" };
  }

  const cached = Repository.join(parts as Repository[]);
  const commit = sources.commit();

  if (commit === null) {
    return { state: "stale", reason: "scan" };
  }

  const dirty = sources.dirtyPaths();

  if (dirty !== null && dirty.length > 0) {
    return { state: "stale", reason: "uncommitted", paths: [...dirty] };
  }

  return dirty !== null &&
    extractionsReusable(cached.extractions, commit, (path) =>
      sources.hashOf(path),
    )
    ? { state: "current", repository: cached }
    : { state: "stale", reason: "scan" };
}
