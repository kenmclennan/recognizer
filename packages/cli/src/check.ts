import { readScanFile } from "./adapters/filesystem/scan-translator.js";
import {
  type BaselineEntry,
  compareEntries,
  type Identity,
  identityKey,
  violationKeys,
} from "./baseline.js";
import type { Policy } from "./policy.js";
import { collectViolations, type Violation } from "./rules.js";

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
      const narrowed: ReportedNew = {
        ...candidate.violation,
        imports: candidate.violation.imports.filter((_, index) =>
          fresh.has(keys[index] as string),
        ),
      };

      return grown ? { ...narrowed, grown: true } : narrowed;
    }),
    fixed: ranking.fixed,
  };
}

export function check(
  scan: unknown,
  policy: Policy,
  baseline: Identity[] | null,
): CheckResult {
  const { violations } = collectViolations(readScanFile(scan), policy);

  return rankAgainstBaseline(violations, baseline);
}
