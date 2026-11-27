import type { Finding } from "./finding.js";
import { linesDuplicated } from "./finding-text.js";

export type FindingsLevel = "none" | "warning" | "violation";

export type FindingsStanding = { violations: number; level: FindingsLevel };

const SEVERITIES: readonly Finding["severity"][] = ["violation", "warning"];

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function withinKind(a: Finding, b: Finding): number {
  if (a.kind === "duplication") {
    return linesDuplicated(b) - linesDuplicated(a) || byCodeUnit(a.id, b.id);
  }

  return (
    byCodeUnit(a.files[0] ?? "", b.files[0] ?? "") || byCodeUnit(a.id, b.id)
  );
}

export function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
    byCodeUnit(a.kind, b.kind) ||
    withinKind(a, b)
  );
}

export function findingsStanding(
  findings: readonly Pick<Finding, "severity">[],
): FindingsStanding {
  const violations = findings.filter(
    (finding) => finding.severity === "violation",
  ).length;

  if (violations > 0) {
    return { violations, level: "violation" };
  }

  return { violations: 0, level: findings.length === 0 ? "none" : "warning" };
}

export function findingsSeverity(
  findings: readonly Pick<Finding, "severity">[],
): Finding["severity"] {
  return findingsStanding(findings).level === "violation"
    ? "violation"
    : "warning";
}

export function findingsHeader(
  findings: readonly Pick<Finding, "severity">[],
): string | null {
  if (findings.length === 0) {
    return null;
  }

  const { violations } = findingsStanding(findings);
  const warnings = findings.length - violations;
  const parts: string[] = [];

  if (violations > 0) {
    parts.push(
      `${violations} ${violations === 1 ? "violation" : "violations"}`,
    );
  }

  if (warnings > 0) {
    parts.push(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  }

  return parts.join(", ");
}
