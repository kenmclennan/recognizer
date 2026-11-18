import { compileGlob } from "./glob.js";
import type { Policy } from "./policy.js";
import type { Scan } from "./scan.js";

export interface PolicyProblem {
  kind: "entry" | "forbid";
  subject: string;
  text: string;
}

const FOREIGN_PREFIX = "foreign:";

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function policyProblems(
  scans: Scan[],
  policy: Policy | null,
): PolicyProblem[] {
  if (
    policy === null ||
    (policy.entryGlobs.length === 0 && policy.forbid.length === 0)
  ) {
    return [];
  }

  const scanned = new Set<string>();

  for (const scan of scans) {
    for (const module of scan.modules) {
      scanned.add(module.id);
    }
  }

  const matchesNothing = (glob: string): boolean => {
    const matches = compileGlob(glob);

    return ![...scanned].some((id) => matches(id));
  };

  const entries = [...new Set(policy.entryGlobs)]
    .filter(matchesNothing)
    .map((glob) => ({
      kind: "entry" as const,
      subject: glob,
      text: `policy entry ${glob} matches no scanned file`,
    }));

  const forbids = new Map<string, PolicyProblem>();

  for (const rule of policy.forbid) {
    for (const glob of [...rule.fromGlobs, ...rule.toGlobs]) {
      const text = `policy forbid ${rule.pattern}: ${glob} matches no scanned file`;

      if (
        !glob.startsWith(FOREIGN_PREFIX) &&
        matchesNothing(glob) &&
        !forbids.has(text)
      ) {
        forbids.set(text, { kind: "forbid", subject: glob, text });
      }
    }
  }

  return [
    ...entries.sort((a, b) => compare(a.subject, b.subject)),
    ...[...forbids.values()].sort(
      (a, b) => compare(a.subject, b.subject) || compare(a.text, b.text),
    ),
  ];
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
