import {
  isEntryPoint,
  isGeneratedFile,
  isLiteralPath,
  isTestFile,
} from "./entry-points.js";
import type { FindingRecord } from "./findings-document.js";
import type { FolderMeasures } from "./folder-metrics.js";
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

function literalPathsOf(policy: Policy | null): Set<string> {
  const literalPaths = new Set<string>();

  for (const globs of policy?.componentGlobs.values() ?? []) {
    for (const glob of globs) {
      if (isLiteralPath(glob)) {
        literalPaths.add(glob);
      }
    }
  }

  return literalPaths;
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
  const literalPaths = literalPathsOf(policy);

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

export function untestedFindings(
  scan: Scan,
  policy: Policy | null,
  entryPoints: string[],
): FindingRecord[] {
  const { ids } = moduleEdges(scan, policy);
  const literalPaths = literalPathsOf(policy);
  const reached = new Set<string>();

  for (const edge of scan.edges) {
    if (edge.inferred !== undefined || !isTestFile(edge.from)) {
      continue;
    }

    reached.add(edge.to);

    for (const through of edge.via ?? []) {
      reached.add(through);
    }
  }

  return [...ids]
    .filter((id) => !reached.has(id))
    .filter((id) => !isGeneratedFile(id))
    .filter((id) => !isEntryPoint(id, literalPaths, entryPoints))
    .sort(compare)
    .map((id) => ({
      id: `untested:${id}`,
      kind: "untested",
      severity: "warning" as const,
      principle: "every-module-has-a-test-that-reaches-it",
      summary: `${id} is reached by no test file (${testConvention(id)})`,
      fix_pattern: "add-a-test",
      evidence: { modules: [id] },
    }));
}

function testConvention(id: string): string {
  const extension = id.slice(id.lastIndexOf(".") + 1);

  switch (extension) {
    case "py":
      return "Python: test_*.py, *_test.py, tests/";
    case "kt":
    case "kts":
      return "Kotlin: src/test/";
    case "rs":
      return "Rust: tests/, *_test.rs";
    default:
      return "TypeScript: *.test.ts, *.spec.ts, __tests__/";
  }
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

function fixed(value: number): string {
  return String(value);
}

export function stableDependenciesFindings(
  measures: FolderMeasures,
): FindingRecord[] {
  const instability = new Map(
    measures.rows.map((row) => [row.id, row.instability]),
  );
  const findings: FindingRecord[] = [];

  for (const [key, held] of measures.between) {
    const [source, target] = key.split("\0") as [string, string];
    const sourceI = instability.get(source) ?? null;
    const targetI = instability.get(target) ?? null;

    if (sourceI === null || targetI === null || !(targetI > sourceI)) {
      continue;
    }

    const edges = [...held].sort(
      (a, b) => compare(a.from, b.from) || compare(a.to, b.to),
    );
    const modules = [
      ...new Set(edges.flatMap((edge) => [edge.from, edge.to])),
    ].sort(compare);

    findings.push({
      id: `stable_dependencies:${source}->${target}`,
      kind: "stable_dependencies",
      severity: "warning",
      principle: "dependencies-point-toward-stability",
      summary: `folder ${source} depends on folder ${target}, which is less stable (instability ${fixed(sourceI)} -> ${fixed(targetI)})`,
      fix_pattern: "depend-on-stabler-folder",
      evidence: {
        modules,
        edges,
        measures: {
          source_instability: sourceI,
          target_instability: targetI,
        },
      },
    });
  }

  return findings.sort((a, b) => compare(a.id, b.id));
}

export function stableAbstractionsFindings(
  measures: FolderMeasures,
  threshold: number,
): FindingRecord[] {
  const findings: FindingRecord[] = [];

  for (const row of measures.rows) {
    const { abstractness, instability, distance } = row;

    if (
      abstractness === null ||
      instability === null ||
      distance === null ||
      !(distance > threshold)
    ) {
      continue;
    }

    const zone = abstractness + instability - 1 < 0 ? "pain" : "useless";

    findings.push({
      id: `stable_abstractions:${row.id}`,
      kind: "stable_abstractions",
      severity: "warning",
      principle: "stable-folders-are-abstract",
      summary: `folder ${row.id} is in the ${zone} zone (abstractness ${fixed(abstractness)}, instability ${fixed(instability)}, distance ${fixed(distance)}, threshold ${fixed(threshold)})`,
      fix_pattern: "move-toward-main-sequence",
      evidence: {
        modules: measures.modulesOf.get(row.id) ?? [],
        measures: {
          afferent: row.afferent,
          efferent: row.efferent,
          instability,
          abstractness,
          distance,
          threshold,
        },
      },
    });
  }

  return findings.sort((a, b) => compare(a.id, b.id));
}
