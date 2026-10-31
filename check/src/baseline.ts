import { InputError } from "./errors.js";

export interface Identity {
  from: string;
  to: string;
  kind: string;
}

export interface IdEntry {
  id: string;
}

export type BaselineEntry = Identity | IdEntry;

const KINDS = new Set(["depends", "inherits", "implements"]);
const VIOLATION_PREFIX = "rule-violation:";

export function violationId(identity: Identity): string {
  return `${VIOLATION_PREFIX}${identity.kind}:${identity.from}->${identity.to}`;
}

export function identityOfViolationId(id: string): Identity | null {
  if (!id.startsWith(VIOLATION_PREFIX)) {
    return null;
  }

  const rest = id.slice(VIOLATION_PREFIX.length);
  const colon = rest.indexOf(":");
  const kind = rest.slice(0, colon);
  const modules = rest.slice(colon + 1);
  const arrow = modules.indexOf("->");

  if (colon < 0 || arrow < 0 || !KINDS.has(kind)) {
    return null;
  }

  return { from: modules.slice(0, arrow), to: modules.slice(arrow + 2), kind };
}

export function identityKey(entry: BaselineEntry): string {
  const identity = isIdEntry(entry) ? identityOfViolationId(entry.id) : entry;

  return identity === null
    ? `\u0000id\u0000${(entry as IdEntry).id}`
    : `${identity.from}\u0000${identity.to}\u0000${identity.kind}`;
}

export function isIdEntry(entry: BaselineEntry): entry is IdEntry {
  return "id" in entry;
}

export function entryId(entry: BaselineEntry): string {
  return isIdEntry(entry) ? entry.id : violationId(entry);
}

export function compareEntries(a: BaselineEntry, b: BaselineEntry): number {
  if (isIdEntry(a) && isIdEntry(b)) {
    return compareStrings(a.id, b.id);
  }

  if (isIdEntry(a)) {
    return 1;
  }

  if (isIdEntry(b)) {
    return -1;
  }

  return compareIdentities(a, b);
}

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

function hasExactKeys(value: object, keys: string[]): boolean {
  const actual = Object.keys(value).sort();

  return (
    actual.length === keys.length && actual.every((key, i) => key === keys[i])
  );
}

export function parseBaseline(jsonText: string): BaselineEntry[] {
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
  const entries: BaselineEntry[] = [];

  record.violations.forEach((entry: unknown, index) => {
    if (typeof entry !== "object" || entry === null) {
      errors.push(
        `baseline violations[${index}] must be {from, to, kind} or {id}`,
      );

      return;
    }

    const asIdentity = entry as Identity;
    const asId = entry as IdEntry;

    if (
      hasExactKeys(entry, ["from", "kind", "to"]) &&
      typeof asIdentity.from === "string" &&
      typeof asIdentity.to === "string" &&
      KINDS.has(asIdentity.kind)
    ) {
      entries.push({
        from: asIdentity.from,
        to: asIdentity.to,
        kind: asIdentity.kind,
      });
    } else if (
      hasExactKeys(entry, ["id"]) &&
      typeof asId.id === "string" &&
      asId.id !== ""
    ) {
      entries.push({ id: asId.id });
    } else {
      errors.push(
        `baseline violations[${index}] must be {from, to, kind} or {id}`,
      );
    }
  });

  if (errors.length > 0) {
    throw new InputError(errors);
  }

  for (let i = 1; i < entries.length; i += 1) {
    const order = compareEntries(
      entries[i - 1] as BaselineEntry,
      entries[i] as BaselineEntry,
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

  const ids = new Set<string>();

  entries.forEach((entry, index) => {
    const id = entryId(entry);

    if (ids.has(id)) {
      throw new InputError([
        `baseline has a duplicate entry at violations[${index}]`,
      ]);
    }

    ids.add(id);
  });

  return entries;
}

export function serialiseBaseline(entries: BaselineEntry[]): string {
  const sorted = entries
    .map((entry) =>
      isIdEntry(entry)
        ? { id: entry.id }
        : { from: entry.from, to: entry.to, kind: entry.kind },
    )
    .sort(compareEntries);

  return `${JSON.stringify({ schema_version: 1, violations: sorted }, null, 2)}\n`;
}
