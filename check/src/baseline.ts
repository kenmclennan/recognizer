import { InputError } from "./errors.js";

export interface Identity {
  from: string;
  to: string;
  kind: string;
}

const KINDS = new Set(["depends", "inherits", "implements"]);

function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  return a > b ? 1 : 0;
}

export function compareIdentities(a: Identity, b: Identity): number {
  return (
    compareStrings(a.from, b.from) ||
    compareStrings(a.to, b.to) ||
    compareStrings(a.kind, b.kind)
  );
}

export function identityKey(identity: Identity): string {
  return `${identity.from}\u0000${identity.to}\u0000${identity.kind}`;
}

function hasExactKeys(value: object, keys: string[]): boolean {
  const actual = Object.keys(value).sort();

  return (
    actual.length === keys.length && actual.every((key, i) => key === keys[i])
  );
}

export function parseBaseline(jsonText: string): Identity[] {
  let document: unknown;

  try {
    document = JSON.parse(jsonText);
  } catch (error) {
    throw new InputError([
      `baseline is not valid JSON: ${(error as Error).message}`,
    ]);
  }

  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document)
  ) {
    throw new InputError(["baseline must be a JSON object"]);
  }

  const record = document as Record<string, unknown>;

  if (!hasExactKeys(record, ["schema_version", "violations"])) {
    throw new InputError([
      "baseline must hold exactly schema_version and violations",
    ]);
  }

  if (record.schema_version !== 1) {
    throw new InputError([
      `baseline schema_version ${String(record.schema_version)} is not supported`,
    ]);
  }

  if (!Array.isArray(record.violations)) {
    throw new InputError(["baseline violations must be a list"]);
  }

  const errors: string[] = [];
  const entries: Identity[] = [];

  record.violations.forEach((entry: unknown, index) => {
    const valid =
      typeof entry === "object" &&
      entry !== null &&
      hasExactKeys(entry, ["from", "kind", "to"]) &&
      typeof (entry as Identity).from === "string" &&
      typeof (entry as Identity).to === "string" &&
      KINDS.has((entry as Identity).kind);

    if (valid) {
      const { from, to, kind } = entry as Identity;
      entries.push({ from, to, kind });
    } else {
      errors.push(`baseline violations[${index}] must be {from, to, kind}`);
    }
  });

  if (errors.length > 0) {
    throw new InputError(errors);
  }

  for (let i = 1; i < entries.length; i += 1) {
    const order = compareIdentities(
      entries[i - 1] as Identity,
      entries[i] as Identity,
    );

    if (order === 0) {
      throw new InputError([
        `baseline has a duplicate entry at violations[${i}]`,
      ]);
    }

    if (order > 0) {
      throw new InputError([`baseline is not sorted at violations[${i}]`]);
    }
  }

  return entries;
}

export function serialiseBaseline(entries: Identity[]): string {
  const sorted = entries
    .map(({ from, to, kind }) => ({ from, to, kind }))
    .sort(compareIdentities);

  return `${JSON.stringify({ schema_version: 1, violations: sorted }, null, 2)}\n`;
}
