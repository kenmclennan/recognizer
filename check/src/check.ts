import { compareIdentities, type Identity, identityKey } from "./baseline.js";
import type { Policy } from "./policy.js";
import { collectViolations, type Violation } from "./rules.js";
import { validateScan } from "./scan.js";

export interface CheckResult {
  violations: Violation[];
  new: Violation[];
  fixed: Identity[];
  unranked: number;
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

  const accepted = new Set((baseline ?? []).map(identityKey));
  const current = new Set(violations.map(identityKey));

  const fixed = (baseline ?? [])
    .filter((entry) => !current.has(identityKey(entry)))
    .map(({ from, to, kind }) => ({ from, to, kind }))
    .sort(compareIdentities);

  return {
    violations,
    new: violations.filter(
      (violation) => !accepted.has(identityKey(violation)),
    ),
    fixed,
    unranked,
  };
}
