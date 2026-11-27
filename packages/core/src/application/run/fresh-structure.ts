import { Repository } from "../../domain/repository.js";
import type { ScanOutcome } from "../../domain/run/scan-outcome.js";
import { InvalidRequest } from "../../domain/run/scan-request.js";
import { extractionsReusable } from "../../domain/scan-reuse.js";

export interface FreshSources {
  isDirectory(root: string): boolean;
  validateConfig(root: string): void;
  detect(root: string): string[];
  readCached(root: string, language: string): Repository | null;
  commit(root: string): string | null;
  dirty(root: string): boolean;
  hashOf(root: string, path: string): string | null;
  extract(): ScanOutcome;
}

export interface FreshStructure {
  repository: Repository;
  scanned: boolean;
}

function readAll(
  sources: FreshSources,
  root: string,
  languages: string[],
): Repository | null {
  const parts = languages.map((language) => sources.readCached(root, language));

  return parts.every((part) => part !== null)
    ? Repository.join(parts as Repository[])
    : null;
}

function isCurrent(
  sources: FreshSources,
  root: string,
  languages: string[],
): Repository | null {
  const cached = readAll(sources, root, languages);

  if (cached === null) {
    return null;
  }

  const commit = sources.commit(root);

  if (commit === null || sources.dirty(root)) {
    return null;
  }

  return extractionsReusable(cached.extractions, commit, (path) =>
    sources.hashOf(root, path),
  )
    ? cached
    : null;
}

function failureOf(outcome: ScanOutcome, root: string): unknown {
  if (outcome.status === "failed" && outcome.reason === "invalid-request") {
    return new InvalidRequest(outcome.messages);
  }

  if (outcome.status === "failed" && outcome.reason === "crashed") {
    return outcome.error ?? new Error("scan crashed");
  }

  return new InvalidRequest([`recognizer scan failed in ${root}`]);
}

export function freshStructure(
  sources: FreshSources,
  root: string,
): FreshStructure {
  if (!sources.isDirectory(root)) {
    throw new InvalidRequest([`repository is not a directory: ${root}`]);
  }

  sources.validateConfig(root);

  const detected = sources.detect(root);

  if (detected.length > 0) {
    const cached = isCurrent(sources, root, detected);

    if (cached !== null) {
      return { repository: cached, scanned: false };
    }
  }

  const outcome = sources.extract();

  if (outcome.status !== "finished") {
    throw failureOf(outcome, root);
  }

  const repository = readAll(sources, root, detected);

  if (repository === null || repository.extractions.length === 0) {
    throw new InvalidRequest([`recognizer scan wrote no scan for ${root}`]);
  }

  return { repository, scanned: true };
}
