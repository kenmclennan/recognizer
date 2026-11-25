import type { DocumentFreshness } from "@recognizer/core";
import type { Freshness } from "recognizer";

export type FreshnessFacts = Record<string, DocumentFreshness>;

export const UNKNOWN_FRESHNESS: DocumentFreshness = {
  valid: false,
  current: [],
  outOfDate: 0,
};

export function judgedBy(
  entry: DocumentFreshness,
): Pick<Freshness, "valid" | "current"> {
  const current = new Set(entry.current);

  return {
    valid: () => entry.valid,
    current: (_measured, module) => current.has(module),
  };
}

export function modulesNotCurrent(
  modules: readonly string[],
  entry: DocumentFreshness,
): Set<string> {
  const current = new Set(entry.current);

  return new Set(modules.filter((id) => !current.has(id)));
}

export function isStale(entry: DocumentFreshness): boolean {
  return !entry.valid || entry.outOfDate > 0;
}
