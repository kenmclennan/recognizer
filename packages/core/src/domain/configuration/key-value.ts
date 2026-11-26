import type { KeyEntry } from "./published-keys.js";

export type Typed = { value: string | number | boolean } | { reason: string };

export function typedValue(entry: KeyEntry, raw: string): Typed {
  const number = (): number | null =>
    /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(raw) &&
    Number.isFinite(Number(raw))
      ? Number(raw)
      : null;

  if (entry.type === "boolean") {
    return raw === "true" || raw === "false"
      ? { value: raw === "true" }
      : { reason: `${raw} is not true or false` };
  }

  if (entry.type === "enum") {
    const values = entry.values ?? [];

    return values.includes(raw)
      ? { value: raw }
      : {
          reason: `${raw} is not allowed; allowed values: ${values.join(", ")}`,
        };
  }

  if (entry.type === "integer" || entry.type === "number") {
    if (entry.off === true && raw === "false") {
      return { value: false };
    }

    if (entry.type === "integer" && !/^[+-]?\d+$/.test(raw)) {
      return { reason: `${raw} is not an integer` };
    }

    const parsed = number();

    if (parsed === null) {
      return { reason: `${raw} is not a number` };
    }

    const bound = outOfBounds(entry, parsed, raw);

    return bound === null ? { value: parsed } : { reason: bound };
  }

  if (raw === "") {
    return { reason: "must not be empty" };
  }

  if (entry.type === "path") {
    if (raw.startsWith("/")) {
      return {
        reason: `${raw} is absolute; it must be relative to the repository`,
      };
    }

    if (raw.split("/").includes("..")) {
      return { reason: `${raw} must not contain a .. segment` };
    }
  }

  return { value: raw };
}

export function outOfBounds(
  entry: KeyEntry,
  value: number,
  raw: string,
): string | null {
  if (entry.minimum !== undefined && value < entry.minimum) {
    return `${raw} is below the minimum ${entry.minimum}`;
  }

  if (entry.exclusiveMinimum !== undefined && value <= entry.exclusiveMinimum) {
    return `${raw} must be above ${entry.exclusiveMinimum}`;
  }

  if (entry.maximum !== undefined && value > entry.maximum) {
    return `${raw} is above the maximum ${entry.maximum}`;
  }

  if (entry.exclusiveMaximum !== undefined && value >= entry.exclusiveMaximum) {
    return `${raw} must be below ${entry.exclusiveMaximum}`;
  }

  return null;
}

export interface SuiteValues {
  language?: unknown;
  runner?: unknown;
  format?: unknown;
}

export interface RefusedValue {
  field: "language" | "runner" | "coverage format";
  value: string;
  allowed: string[];
  reason: string;
  path: string;
}

const SUITE_FIELDS = [
  { field: "language", leaf: "language", path: "language" },
  { field: "runner", leaf: "runner", path: "runner" },
  {
    field: "coverage format",
    leaf: "coverage.format",
    path: "coverage/format",
  },
] as const;

export function refusedSuiteValues(
  suite: SuiteValues,
  keys: readonly { key: string; values?: string[] }[],
): RefusedValue[] {
  const given = {
    language: suite.language,
    runner: suite.runner,
    "coverage format": suite.format,
  };

  return SUITE_FIELDS.flatMap(({ field, leaf, path }) => {
    const value = given[field];
    const published = keys.find(
      (entry) => entry.key === `tests.<name>.${leaf}`,
    )?.values;

    if (typeof value !== "string" || published === undefined) {
      return [];
    }

    const typed = typedValue(
      { type: "enum", values: published } as KeyEntry,
      value,
    );

    return "reason" in typed
      ? [{ field, value, allowed: published, reason: typed.reason, path }]
      : [];
  });
}

export function unpublishedValues(
  document: unknown,
  keys: readonly { key: string; values?: string[] }[],
): string[] {
  const tests = (document as { tests?: unknown } | null)?.tests;

  if (!Array.isArray(tests)) {
    return [];
  }

  return tests.flatMap((suite, index) => {
    if (typeof suite !== "object" || suite === null) {
      return [];
    }

    const record = suite as Record<string, unknown>;
    const coverage = record.coverage as { format?: unknown } | undefined;
    const name = typeof record.name === "string" ? record.name : String(index);

    return refusedSuiteValues(
      {
        language: record.language,
        runner: record.runner,
        format: coverage?.format,
      },
      keys,
    ).map(
      (refused) =>
        `config/tests/${index}/${refused.path} ${refused.reason} (suite ${name})`,
    );
  });
}

export interface RetiredSetting {
  key: string;
  reason: string;
}

function leafKeys(value: unknown, trail: string[]): string[] {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([name, inner]) =>
      leafKeys(inner, [...trail, name]),
    );
  }

  return trail.length === 0 ? [] : [trail.join(".")];
}

function covers(published: string, set: string): boolean {
  const wanted = published.split(".");
  const given = set.split(".");

  return (
    wanted.length === given.length &&
    wanted.every(
      (part, at) => /^<[a-z][a-z0-9_]*>$/.test(part) || part === given[at],
    )
  );
}

export function retiredSettings(
  document: unknown,
  keys: readonly { key: string; retired?: string }[],
): RetiredSetting[] {
  const retired = keys.filter(
    (entry): entry is { key: string; retired: string } =>
      entry.retired !== undefined,
  );

  return leafKeys(document, []).flatMap((set) => {
    const hit = retired.find((entry) => covers(entry.key, set));

    return hit === undefined ? [] : [{ key: set, reason: hit.retired }];
  });
}
