import { isEntryPoint, isLiteralPath } from "./entry-points.js";
import type { FindingRecord } from "./findings-document.js";
import { compileGlob, matchesAny } from "./glob.js";
import { isForeign, keptGraph } from "./graph.js";
import type { Policy } from "./policy.js";
import type { Scan } from "./scan.js";

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function folderOf(id: string): string {
  const at = id.lastIndexOf("/");

  return at < 0 ? "." : id.slice(0, at);
}

function moduleEdges(scan: Scan, policy: Policy | null) {
  const { edges, ids } = keptGraph(scan, policy?.ignore ?? []);
  const seen = new Set<string>();
  const pairs: { from: string; to: string }[] = [];

  for (const edge of edges) {
    if (edge.from === edge.to || isForeign(edge.to)) {
      continue;
    }

    const key = `${edge.from}\0${edge.to}`;

    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ from: edge.from, to: edge.to });
    }
  }

  return { ids, pairs };
}

export function folderCycleFindings(
  scan: Scan,
  policy: Policy | null,
): FindingRecord[] {
  const { pairs } = moduleEdges(scan, policy);
  const byFolders = new Map<string, { from: string; to: string }[]>();

  for (const pair of pairs) {
    const source = folderOf(pair.from);
    const target = folderOf(pair.to);

    if (source === target) {
      continue;
    }

    const key = `${source}\0${target}`;

    byFolders.set(key, [...(byFolders.get(key) ?? []), pair]);
  }

  const findings: FindingRecord[] = [];

  for (const [key, forward] of byFolders) {
    const [source, target] = key.split("\0") as [string, string];

    if (source > target) {
      continue;
    }

    const backward = byFolders.get(`${target}\0${source}`);

    if (backward === undefined) {
      continue;
    }

    const edges = [...forward, ...backward].sort(
      (a, b) => compare(a.from, b.from) || compare(a.to, b.to),
    );
    const modules = [
      ...new Set(edges.flatMap((edge) => [edge.from, edge.to])),
    ].sort(compare);

    findings.push({
      id: `folder_cycle:${source},${target}`,
      kind: "folder_cycle",
      severity: "warning",
      principle: "no-cycles",
      summary: `folders ${source} and ${target} import each other (${edges.length} edges)`,
      fix_pattern: "break-folder-cycle",
      evidence: { modules, edges },
    });
  }

  return findings.sort((a, b) => compare(a.id, b.id));
}

export function orphanFindings(
  scan: Scan,
  policy: Policy | null,
  entryPoints: string[],
): FindingRecord[] {
  const { ids, pairs } = moduleEdges(scan, policy);
  const imported = new Set(pairs.map((pair) => pair.to));
  const literalPaths = new Set<string>();

  for (const globs of policy?.componentGlobs.values() ?? []) {
    for (const glob of globs) {
      if (isLiteralPath(glob)) {
        literalPaths.add(glob);
      }
    }
  }

  return [...ids]
    .filter((id) => !imported.has(id))
    .filter((id) => !isEntryPoint(id, literalPaths, entryPoints))
    .sort(compare)
    .map((id) => ({
      id: `orphan:${id}`,
      kind: "orphan",
      severity: "warning" as const,
      principle: "every-module-is-reachable",
      summary: `${id} is imported by no module and is not an entry point`,
      fix_pattern: "remove-or-wire-orphan",
      evidence: { modules: [id] },
    }));
}

export function policyDriftFindings(
  scans: Scan[],
  policy: Policy | null,
): FindingRecord[] {
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

  const unmatched: FindingRecord[] = [...entries]
    .filter(([glob]) => {
      const matches = compileGlob(glob);

      return ![...scanned].some((id) => matches(id));
    })
    .map(([glob, name]) => ({
      id: `policy_drift:entry:${glob}`,
      kind: "policy_drift",
      severity: "warning" as const,
      principle: "policy-describes-the-code",
      summary: `policy entry ${glob} (component ${name}) matches no scanned module`,
      fix_pattern: "update-policy",
      evidence: { modules: [] },
    }))
    .sort((a, b) => compare(a.id, b.id));

  const matchers = [...policy.components.values()].flat();
  const uncovered: FindingRecord[] = [...keptByFolder]
    .filter(([, ids]) => !ids.some((id) => matchesAny(matchers, id)))
    .map(([folder, ids]) => ({
      id: `policy_drift:folder:${folder}`,
      kind: "policy_drift",
      severity: "warning" as const,
      principle: "policy-describes-the-code",
      summary: `folder ${folder} holds ${ids.length} scanned modules that no component covers`,
      fix_pattern: "update-policy",
      evidence: { modules: [...ids].sort(compare) },
    }))
    .sort((a, b) => compare(a.id, b.id));

  return [...unmatched, ...uncovered];
}
