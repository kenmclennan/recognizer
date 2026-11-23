import type { PolicyRule, Violation } from "@recognizer/core";
import { readScanFile } from "./adapters/filesystem/scan-translator.js";
import {
  type BaselineEntry,
  compareEntries,
  type Identity,
  identityKey,
  violationKeys,
} from "./baseline.js";

export type ReportedNew = Violation & { grown?: true };

export interface CheckResult {
  violations: Violation[];
  new: ReportedNew[];
  fixed: BaselineEntry[];
}

export interface Keyed {
  keys: string[];
}

export interface Fresh<T> {
  candidate: T;
  fresh: Set<string>;
  grown: boolean;
}

export interface Ranking<T> {
  new: Fresh<T>[];
  fixed: BaselineEntry[];
}

export function rankByKeys<T extends Keyed>(
  current: T[],
  baseline: BaselineEntry[] | null,
): Ranking<T> {
  const accepted = new Set((baseline ?? []).map(identityKey));
  const present = new Set(current.flatMap((one) => one.keys));
  const fixed = (baseline ?? [])
    .filter((entry) => !present.has(identityKey(entry)))
    .sort(compareEntries);
  const fresh: Fresh<T>[] = [];

  for (const candidate of current) {
    const outside = new Set(candidate.keys.filter((key) => !accepted.has(key)));

    if (outside.size > 0) {
      fresh.push({
        candidate,
        fresh: outside,
        grown: outside.size < new Set(candidate.keys).size,
      });
    }
  }

  return { new: fresh, fixed };
}

export function rankAgainstBaseline(
  violations: Violation[],
  baseline: Identity[] | BaselineEntry[] | null,
): CheckResult {
  const ranking = rankByKeys(
    violations.map((violation) => ({
      violation,
      keys: violationKeys(violation),
    })),
    baseline,
  );

  return {
    violations,
    new: ranking.new.map(({ candidate, fresh, grown }) => {
      const keys = candidate.keys;
      const narrowed: ReportedNew = candidate.violation.narrowedTo((_, index) =>
        fresh.has(keys[index] as string),
      );

      return grown
        ? Object.assign(narrowed, { grown: true as const })
        : narrowed;
    }),
    fixed: ranking.fixed,
  };
}

export function check(
  scan: unknown,
  policy: readonly PolicyRule[],
  baseline: Identity[] | null,
): CheckResult {
  const violations = readScanFile(scan).violations(policy);

  return rankAgainstBaseline(violations, baseline);
}
