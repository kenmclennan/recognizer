import { compileGlob } from "../glob.js";
import { PolicyRule } from "../policy-rule.js";
import type { Repository } from "../repository.js";

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
  repository: Repository,
  policy: readonly PolicyRule[] | null,
): PolicyProblem[] {
  const entryRules = PolicyRule.entries(policy);
  const forbidRules = PolicyRule.forbids(policy);

  if (entryRules.length === 0 && forbidRules.length === 0) {
    return [];
  }

  const scanned = new Set<string>();

  for (const file of repository.files) {
    scanned.add(file.path);
  }

  const matchesNothing = (glob: string): boolean => {
    const matches = compileGlob(glob);

    return ![...scanned].some((id) => matches(id));
  };

  const entries = [...new Set(entryRules.map((rule) => rule.glob))]
    .filter(matchesNothing)
    .map((glob) => ({
      kind: "entry" as const,
      subject: glob,
      text: `policy entry ${glob} matches no scanned file`,
    }));

  const forbids = new Map<string, PolicyProblem>();

  for (const rule of forbidRules) {
    for (const glob of [...rule.from, ...rule.to]) {
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
