import type { FindingRecord, FindingsDocument } from "./findings-document.js";
import { principleName } from "./principles.js";
import type { Violation } from "./rules.js";

export type Finding = {
  severity: "violation" | "warning";
  text: string;
  why: string;
};

export function ruleText(violation: Pick<Violation, "rules">): string {
  const rule = violation.rules[0];

  if (rule === undefined) {
    return "";
  }

  if (rule.type === "level") {
    return `level ${rule.from_level} -> ${rule.to_level}`;
  }

  if (rule.type === "uses") {
    return `uses ${rule.from_component} -> ${rule.to_component}`;
  }

  return `forbid ${rule.pattern}`;
}

export function violationText(violation: Violation): string {
  const verb = violation.kind === "depends" ? "depends on" : violation.kind;

  return `${verb} ${violation.to} at line ${violation.lines.join(", ")}`;
}

export function findingsByModuleFrom(
  documents: FindingsDocument[],
): Map<string, Finding[]> {
  const violations = new Map<string, Finding[]>();
  const warnings = new Map<string, Finding[]>();

  function add(target: Map<string, Finding[]>, id: string, finding: Finding) {
    target.set(id, [...(target.get(id) ?? []), finding]);
  }

  for (const document of documents) {
    for (const record of document.findings) {
      const isViolation = record.severity === "violation";
      const rules = record.evidence.edges?.[0]?.rules;
      const why =
        isViolation && rules !== undefined
          ? ruleText({ rules })
          : principleName(record.principle);

      for (const id of record.evidence.modules) {
        add(isViolation ? violations : warnings, id, {
          severity: record.severity,
          text: record.summary,
          why,
        });
      }
    }
  }

  const merged = new Map<string, Finding[]>();

  for (const id of new Set([...violations.keys(), ...warnings.keys()])) {
    merged.set(id, [
      ...(violations.get(id) ?? []),
      ...(warnings.get(id) ?? []),
    ]);
  }

  return merged;
}

export function linesDuplicated(record: FindingRecord): number {
  return (record.evidence.members ?? []).reduce(
    (sum, member) =>
      member.lines === undefined
        ? sum
        : sum + (member.lines[1] - member.lines[0] + 1),
    0,
  );
}

export function orderDuplication(records: FindingRecord[]): FindingRecord[] {
  const ranked = records
    .filter((record) => record.kind === "duplication")
    .sort(
      (a, b) =>
        linesDuplicated(b) - linesDuplicated(a) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  let next = 0;

  return records.map((record) =>
    record.kind === "duplication" ? (ranked[next++] as FindingRecord) : record,
  );
}
