import { compileGlob } from "./glob.js";
import type { Policy } from "./policy.js";
import type { Scan } from "./scan.js";

export interface PolicyProblem {
  kind: "entry";
  subject: string;
  text: string;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function policyProblems(
  scans: Scan[],
  policy: Policy | null,
): PolicyProblem[] {
  if (policy === null || policy.entryGlobs.length === 0) {
    return [];
  }

  const scanned = new Set<string>();

  for (const scan of scans) {
    for (const module of scan.modules) {
      scanned.add(module.id);
    }
  }

  return [...new Set(policy.entryGlobs)]
    .filter((glob) => {
      const matches = compileGlob(glob);

      return ![...scanned].some((id) => matches(id));
    })
    .map((glob) => ({
      kind: "entry" as const,
      subject: glob,
      text: `policy entry ${glob} matches no scanned module`,
    }))
    .sort((a, b) => compare(a.subject, b.subject));
}

export function warnPolicyProblems(
  stderr: (text: string) => void,
  policyFile: string,
  scans: Scan[],
  policy: Policy | null,
): void {
  for (const problem of policyProblems(scans, policy)) {
    stderr(`warning: ${policyFile}: ${problem.text}\n`);
  }
}
