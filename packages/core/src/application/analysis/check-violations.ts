import type { PolicyRule } from "../../domain/policy-rule.js";
import type { Repository } from "../../domain/repository.js";
import {
  type CheckResult,
  rankAgainstBaseline,
} from "../history/rank-against-baseline.js";
import type { Identity } from "../history/settle-baseline.js";

export function checkViolations(
  repository: Repository,
  rules: readonly PolicyRule[],
  baseline: Identity[] | null,
): CheckResult {
  return rankAgainstBaseline(repository.violations(rules), baseline);
}
