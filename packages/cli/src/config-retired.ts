export { thresholdsMigration as toleratedMigration } from "./config-thresholds.js";

import { RETIRED_KEYS, type RetiredKey, retiredKeyFor } from "@recognizer/core";

export { RETIRED_KEYS, type RetiredKey, retiredKeyFor };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function holds(document: unknown, path: string[]): boolean {
  let at: unknown = document;

  for (const step of path) {
    if (!isPlainObject(at) || !(step in at)) {
      return false;
    }

    at = at[step];
  }

  return true;
}

export function retiredKeysIn(document: unknown): RetiredKey[] {
  return RETIRED_KEYS.filter((retired) => holds(document, retired.path));
}

export function withoutRetiredKeysAndEmptiedSections(
  document: unknown,
  only: (retired: RetiredKey) => boolean = () => true,
): unknown {
  if (!isPlainObject(document)) {
    return document;
  }

  const copy = structuredClone(document) as Record<string, unknown>;

  for (const { path } of retiredKeysIn(copy).filter(only)) {
    const trail: Record<string, unknown>[] = [copy];

    for (const step of path.slice(0, -1)) {
      trail.push(trail[trail.length - 1]?.[step] as Record<string, unknown>);
    }

    delete trail[trail.length - 1]?.[path[path.length - 1] as string];

    for (let depth = trail.length - 1; depth > 0; depth -= 1) {
      if (Object.keys(trail[depth] as object).length > 0) {
        break;
      }

      delete trail[depth - 1]?.[path[depth - 1] as string];
    }
  }

  return copy;
}

export function withoutRetiredKeys(document: unknown): unknown {
  if (!isPlainObject(document)) {
    return document;
  }

  const copy = structuredClone(document) as Record<string, unknown>;

  for (const { path } of retiredKeysIn(copy)) {
    let at: unknown = copy;

    for (const step of path.slice(0, -1)) {
      at = (at as Record<string, unknown>)[step];
    }

    delete (at as Record<string, unknown>)[path[path.length - 1] as string];
  }

  return copy;
}

export function withoutToleratedKeys(document: unknown): unknown {
  return withoutRetiredKeysAndEmptiedSections(
    document,
    (retired) => retired.tolerated === true,
  );
}
