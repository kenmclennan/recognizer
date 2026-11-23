import type { Finding, FindingRule, SensorFindings } from "@recognizer/core";
import { principleName } from "./principles.js";
import type { Violation, ViolationImport } from "./rules.js";

export type FindingNote = {
  severity: "violation" | "warning";
  text: string;
  why: string;
};

export function ruleText(rule: FindingRule): string {
  if (rule.type === "level") {
    return `level ${rule.fromLevel} -> ${rule.toLevel}`;
  }

  if (rule.type === "uses") {
    return `uses ${rule.fromComponent} -> ${rule.toComponent}`;
  }

  return `forbid ${rule.pattern}`;
}

export function importText(one: ViolationImport): string {
  const verb = one.kind === "depends" ? "depends on" : one.kind;

  return `${verb} ${one.to} at line ${one.lines.join(", ")}`;
}

export function violationText(violation: Violation): string {
  return violation.imports.map(importText).join("; ");
}

export function findingsByModuleFrom(
  documents: SensorFindings[],
): Map<string, FindingNote[]> {
  const violations = new Map<string, FindingNote[]>();
  const warnings = new Map<string, FindingNote[]>();

  function add(
    target: Map<string, FindingNote[]>,
    id: string,
    finding: FindingNote,
  ) {
    target.set(id, [...(target.get(id) ?? []), finding]);
  }

  for (const document of documents) {
    for (const record of document.findings) {
      const isViolation = record.severity === "violation";
      const rule = record.dependencies?.[0]?.rules?.[0];
      const why =
        isViolation && rule !== undefined
          ? ruleText(rule)
          : principleName(record.principle);

      for (const id of record.files) {
        add(isViolation ? violations : warnings, id, {
          severity: record.severity,
          text: record.summary,
          why,
        });
      }
    }
  }

  const merged = new Map<string, FindingNote[]>();

  for (const id of new Set([...violations.keys(), ...warnings.keys()])) {
    merged.set(id, [
      ...(violations.get(id) ?? []),
      ...(warnings.get(id) ?? []),
    ]);
  }

  return merged;
}

export function linesDuplicated(record: Finding): number {
  return (record.members ?? []).reduce(
    (sum, member) =>
      member.lines === undefined
        ? sum
        : sum + (member.lines[1] - member.lines[0] + 1),
    0,
  );
}

export function orderDuplication(records: readonly Finding[]): Finding[] {
  const ranked = records
    .filter((record) => record.kind === "duplication")
    .sort(
      (a, b) =>
        linesDuplicated(b) - linesDuplicated(a) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  let next = 0;

  return records.map((record) =>
    record.kind === "duplication" ? (ranked[next++] as Finding) : record,
  );
}
