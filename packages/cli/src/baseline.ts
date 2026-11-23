import type {
  BaselineEntry,
  Finding,
  IdEntry,
  Identity,
  Violation,
} from "@recognizer/core";
import { InputError } from "./errors.js";
import { importText, ruleText } from "./findings.js";

export type { BaselineEntry, IdEntry, Identity };

const KINDS = new Set(["depends", "inherits", "implements"]);
const VIOLATION_PREFIX = "rule-violation:";

export function violationId(violation: Pick<Violation, "file" | "rule">) {
  return `${VIOLATION_PREFIX}${ruleText(violation.rule)}:${violation.file}`;
}

export function edgeId(identity: Identity): string {
  return `${VIOLATION_PREFIX}${identity.kind}:${identity.from}->${identity.to}`;
}

export function violationKeys(violation: Violation): string[] {
  return violation.dependencies.map((one) =>
    identityKey({ from: violation.file, to: one.to, kind: one.kind }),
  );
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

export function narrowViolationRecord(
  record: Finding,
  accepted: Set<string>,
): Finding | null {
  const edges = record.dependencies ?? [];

  if (
    record.kind !== "rule-violation" ||
    edges.length === 0 ||
    edges.some((edge) => edge.kind === undefined)
  ) {
    return accepted.has(identityKey(record)) ? null : record;
  }

  const kept = edges.filter(
    (edge) =>
      !accepted.has(
        identityKey({
          from: edge.from,
          to: edge.to,
          kind: edge.kind as string,
        }),
      ),
  );

  if (kept.length === 0) {
    return null;
  }

  if (kept.length === edges.length) {
    return record;
  }

  return record.with({
    summary: kept
      .map((edge) =>
        importText({
          to: edge.to,
          kind: edge.kind as string,
          lines: [...(edge.lines ?? [])],
        }),
      )
      .join("; "),
    dependencies: kept,
  });
}

export function isIdEntry(entry: BaselineEntry): entry is IdEntry {
  return "id" in entry;
}

export function entryId(entry: BaselineEntry): string {
  return isIdEntry(entry) ? entry.id : edgeId(entry);
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
