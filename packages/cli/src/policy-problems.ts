import {
  type PolicyProblem,
  type PolicyRule,
  policyProblems,
  type Repository,
} from "@recognizer/core";

export { type PolicyProblem, policyProblems };

export function warnPolicyProblems(
  stderr: (text: string) => void,
  policyFile: string,
  repository: Repository,
  policy: readonly PolicyRule[] | null,
): void {
  for (const problem of policyProblems(repository, policy)) {
    stderr(`warning: ${policyFile}: ${problem.text}\n`);
  }
}
