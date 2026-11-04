import { strongComponents } from "./analyse.js";
import { isEntryPoint, isLiteralPath } from "./entry-points.js";
import type { FindingRecord } from "./findings-document.js";
import type { FolderMeasures } from "./folder-metrics.js";
import { compileGlob, matchesAny } from "./glob.js";
import { isForeign, keptGraph } from "./graph.js";
import type { Policy } from "./policy.js";
import type { Scan, ScanEdge, ScanMember } from "./scan.js";

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

function folderSummary(folders: string[], edgeCount: number): string {
  if (folders.length === 2) {
    return `folders ${folders[0]} and ${folders[1]} import each other (${edgeCount} edges)`;
  }

  return `folders ${folders.join(", ")} import each other in a cycle (${edgeCount} edges)`;
}

export function folderCycleFindings(
  scan: Scan,
  policy: Policy | null,
): FindingRecord[] {
  const { pairs } = moduleEdges(scan, policy);
  const crossing = pairs.filter(
    (pair) => folderOf(pair.from) !== folderOf(pair.to),
  );
  const successors = new Map<string, string[]>();

  for (const pair of crossing) {
    const source = folderOf(pair.from);
    const target = folderOf(pair.to);

    successors.set(source, [...(successors.get(source) ?? []), target]);

    if (!successors.has(target)) {
      successors.set(target, []);
    }
  }

  for (const [folder, targets] of successors) {
    successors.set(folder, [...new Set(targets)].sort(compare));
  }

  const findings: FindingRecord[] = [];

  for (const component of strongComponents(
    [...successors.keys()].sort(compare),
    successors,
  )) {
    if (component.length < 2) {
      continue;
    }

    const folders = [...component].sort(compare);
    const members = new Set(folders);
    const edges = crossing
      .filter(
        (pair) =>
          members.has(folderOf(pair.from)) && members.has(folderOf(pair.to)),
      )
      .sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to));
    const modules = [
      ...new Set(edges.flatMap((edge) => [edge.from, edge.to])),
    ].sort(compare);

    findings.push({
      id: `folder_cycle:${folders.join(",")}`,
      kind: "folder_cycle",
      severity: "warning",
      principle: "no-cycles",
      summary: folderSummary(folders, edges.length),
      fix_pattern: "break-folder-cycle",
      evidence: { modules, edges },
    });
  }

  return findings.sort((a, b) => compare(a.id, b.id));
}

function policyLiteralPaths(policy: Policy | null): Set<string> {
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

export function orphanFindings(
  scan: Scan,
  policy: Policy | null,
  entryPoints: string[],
): FindingRecord[] {
  const { ids, pairs } = moduleEdges(scan, policy);
  const imported = new Set(pairs.map((pair) => pair.to));
  const literalPaths = policyLiteralPaths(policy);
  const scanned = new Set(
    scan.modules
      .filter((module) => module.entry_point === true)
      .map((module) => module.id),
  );

  return [...ids]
    .filter((id) => !imported.has(id))
    .filter(
      (id) => !isEntryPoint(id, literalPaths, entryPoints, scanned.has(id)),
    )
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

function usedNames(edges: ScanEdge[]) {
  const named = new Map<string, Set<string>>();
  const whole = new Set<string>();

  for (const edge of edges) {
    if (isForeign(edge.to) || edge.from === edge.to) {
      continue;
    }

    if (edge.kind === "depends") {
      if (edge.names !== undefined && edge.names.length > 0) {
        const held = named.get(edge.to) ?? new Set<string>();

        for (const name of edge.names) {
          held.add(name);
        }

        named.set(edge.to, held);
      } else {
        whole.add(edge.to);
      }
    } else if (edge.to_member !== undefined) {
      const held = named.get(edge.to) ?? new Set<string>();

      held.add(edge.to_member);
      named.set(edge.to, held);
    }
  }

  return { named, whole };
}

function isUsed(name: string, used: Set<string>): boolean {
  return used.has(name) || used.has(name.split(".", 1)[0] as string);
}

export function unusedExportsFindings(
  scan: Scan,
  policy: Policy | null,
  entryPoints: string[],
): FindingRecord[] {
  const { edges, ids } = keptGraph(scan, policy?.ignore ?? []);
  const { named, whole } = usedNames(edges);
  const literalPaths = policyLiteralPaths(policy);
  const findings: FindingRecord[] = [];

  for (const module of scan.modules) {
    if (
      !ids.has(module.id) ||
      whole.has(module.id) ||
      isEntryPoint(
        module.id,
        literalPaths,
        entryPoints,
        module.entry_point === true,
      )
    ) {
      continue;
    }

    const first = new Map<string, ScanMember>();

    for (const member of module.members ?? []) {
      if (member.exported && !first.has(member.name)) {
        first.set(member.name, member);
      }
    }

    const used = named.get(module.id) ?? new Set<string>();
    const unused = [...first.keys()]
      .sort(compare)
      .filter((name) => !isUsed(name, used))
      .map((name) => first.get(name) as ScanMember);

    if (unused.length === 0) {
      continue;
    }

    const noun = unused.length === 1 ? "name" : "names";
    const names = unused.map((member) => member.name).join(", ");

    findings.push({
      id: `unused_exports:${module.id}`,
      kind: "unused_exports",
      severity: "warning",
      principle: "export-only-what-is-used",
      summary: `${module.id} exports ${unused.length} ${noun} no other module imports: ${names}`,
      fix_pattern: "narrow-exports",
      evidence: {
        modules: [module.id],
        members: unused.map((member) => ({
          module: module.id,
          name: member.name,
          ...(module.kind === "module" && member.line !== undefined
            ? { file: module.id, lines: [member.line, member.line] }
            : {}),
        })),
      },
    });
  }

  return findings.sort((a, b) => compare(a.id, b.id));
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
