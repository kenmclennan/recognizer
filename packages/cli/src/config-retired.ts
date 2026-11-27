import {
  RETIRED_KEYS,
  type RetiredKey,
  retiredKeyFor,
  retiredKeysIn,
  thresholdsMigration,
} from "@recognizer/core";

export {
  RETIRED_KEYS,
  type RetiredKey,
  retiredKeyFor,
  retiredKeysIn,
  thresholdsMigration as toleratedMigration,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function withoutToleratedKeys(document: unknown): unknown {
  return withoutRetiredKeysAndEmptiedSections(
    document,
    (retired) => retired.tolerated === true,
  );
}
