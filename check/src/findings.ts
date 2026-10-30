import { analyse } from "./analyse.js";
import type { Policy } from "./policy.js";
import { collectViolations, type Violation } from "./rules.js";
import type { Scan } from "./scan.js";

export type Finding = {
  severity: "violation" | "warning";
  text: string;
  why: string;
};

export function ruleText(violation: Violation): string {
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

export function findingsByModule(
  scans: Scan[],
  policy: Policy | null,
  hub: number,
): Map<string, Finding[]> {
  const violations = new Map<string, Finding[]>();
  const warnings = new Map<string, Finding[]>();

  function add(target: Map<string, Finding[]>, id: string, finding: Finding) {
    target.set(id, [...(target.get(id) ?? []), finding]);
  }

  for (const scan of scans) {
    if (policy !== null) {
      for (const violation of collectViolations(scan, policy).violations) {
        add(violations, violation.from, {
          severity: "violation",
          text: violationText(violation),
          why: ruleText(violation),
        });
      }
    }

    const analysis = analyse(scan, { hub }, policy?.ignore);

    for (const warning of analysis.warnings) {
      const ids =
        warning.id === "cycle"
          ? warning.evidence.modules
          : [warning.evidence.module];

      for (const id of ids) {
        add(warnings, id, {
          severity: "warning",
          text: warning.summary,
          why: warning.principle,
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
