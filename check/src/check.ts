import {
  type BaselineEntry,
  compareEntries,
  entryId,
  type Identity,
  violationId,
} from "./baseline.js";
import type { Policy } from "./policy.js";
import { collectViolations, type Violation } from "./rules.js";
import { validateScan } from "./scan.js";

export interface CheckResult {
  violations: Violation[];
  new: Violation[];
  fixed: BaselineEntry[];
  unranked: number;
}

export interface Ranking<T> {
  new: T[];
  fixed: BaselineEntry[];
}

export function rankById<T extends { id: string }>(
  current: T[],
  baseline: BaselineEntry[] | null,
): Ranking<T> {
  const accepted = new Set((baseline ?? []).map(entryId));
  const present = new Set(current.map((one) => one.id));
  const fixed = (baseline ?? [])
    .filter((entry) => !present.has(entryId(entry)))
    .sort(compareEntries);

  return { new: current.filter((one) => !accepted.has(one.id)), fixed };
}

export function rankAgainstBaseline(
  violations: Violation[],
  unranked: number,
  baseline: Identity[] | BaselineEntry[] | null,
): CheckResult {
  const identified = violations.map((violation) => ({
    id: violationId(violation),
    violation,
  }));
  const ranking = rankById(identified, baseline);

  return {
    violations,
    new: ranking.new.map((one) => one.violation),
    fixed: ranking.fixed,
    unranked,
  };
}

export function check(
  scan: unknown,
  policy: Policy,
  baseline: Identity[] | null,
): CheckResult {
  const { violations, unranked } = collectViolations(
    validateScan(scan),
    policy,
  );

  return rankAgainstBaseline(violations, unranked, baseline);
}
