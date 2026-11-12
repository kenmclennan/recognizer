import { compileGlob, matchesAny } from "./glob.js";
import { keptGraph } from "./graph.js";
import type { Policy } from "./policy.js";
import type { Scan } from "./scan.js";
import { folderOf } from "./structure-warnings.js";

export interface PolicyProblem {
  kind: "entry" | "folder";
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
  if (policy === null || policy.components.size === 0) {
    return [];
  }

  const scanned = new Set<string>();
  const keptByFolder = new Map<string, string[]>();

  for (const scan of scans) {
    for (const module of scan.modules) {
      scanned.add(module.id);
    }

    for (const id of keptGraph(scan, policy.ignore).ids) {
      const folder = folderOf(id);
      const held = keptByFolder.get(folder) ?? [];

      if (!held.includes(id)) {
        held.push(id);
      }

      keptByFolder.set(folder, held);
    }
  }

  const entries = new Map<string, string>();

  for (const [name, globs] of policy.componentGlobs) {
    for (const glob of globs) {
      if (!entries.has(glob)) {
        entries.set(glob, name);
      }
    }
  }

  const unmatched: PolicyProblem[] = [...entries]
    .filter(([glob]) => {
      const matches = compileGlob(glob);

      return ![...scanned].some((id) => matches(id));
    })
    .map(([glob, name]) => ({
      kind: "entry" as const,
      subject: glob,
      text: `policy entry ${glob} (component ${name}) matches no scanned module`,
    }))
    .sort((a, b) => compare(a.subject, b.subject));

  const matchers = [...policy.components.values()].flat();
  const uncovered: PolicyProblem[] = [...keptByFolder]
    .filter(([, ids]) => !ids.some((id) => matchesAny(matchers, id)))
    .map(([folder, ids]) => ({
      kind: "folder" as const,
      subject: folder,
      text: `folder ${folder} holds ${ids.length} scanned modules that no component covers`,
    }))
    .sort((a, b) => compare(a.subject, b.subject));

  return [...unmatched, ...uncovered];
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
