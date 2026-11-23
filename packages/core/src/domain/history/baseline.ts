import type { Finding } from "../finding.js";
import { importText, ruleText } from "../finding-text.js";
import type { Violation } from "../violation.js";
import type {
  BaselineEntry,
  IdEntry,
  Identity,
} from "./baseline-repository.js";

export const BASELINE_KINDS = new Set(["depends", "inherits", "implements"]);
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

  if (colon < 0 || arrow < 0 || !BASELINE_KINDS.has(kind)) {
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
