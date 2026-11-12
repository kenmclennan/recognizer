import { isEntryPoint, isLiteralPath, isTestFile } from "./entry-points.js";
import type { FindingRecord } from "./findings-document.js";
import { isForeign, keptGraph } from "./graph.js";
import type { Policy } from "./policy.js";
import type { Scan, ScanEdge, ScanMember } from "./scan.js";
import {
  libraryApiHint,
  testImportersOf,
  testOnlySummary,
  unusedTestOnlyClause,
} from "./test-importers.js";

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function folderOf(id: string): string {
  const at = id.lastIndexOf("/");

  return at < 0 ? "." : id.slice(0, at);
}

function moduleEdges(scan: Scan, policy: Policy | null) {
  const { edges, declarations, ids } = keptGraph(scan, policy?.ignore ?? []);
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

  return { ids, pairs, declarations };
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

function reachedModules(
  scan: Scan,
  ids: Set<string>,
  imported: Set<string>,
  isEntry: (id: string) => boolean,
): Set<string> {
  const reached = new Set<string>();

  for (const id of ids) {
    if (imported.has(id) || isEntry(id)) {
      reached.add(id);
    }
  }

  const actuals = scan.modules.filter(
    (module) => module.actual_of !== undefined && ids.has(module.id),
  );
  let grew = true;

  while (grew) {
    grew = false;

    for (const module of actuals) {
      if (
        !reached.has(module.id) &&
        (module.actual_of ?? []).some((expect) => reached.has(expect))
      ) {
        reached.add(module.id);
        grew = true;
      }
    }
  }

  return reached;
}

export function orphanFindings(
  scan: Scan,
  policy: Policy | null,
  entryPoints: string[],
): FindingRecord[] {
  const { ids, pairs, declarations } = moduleEdges(scan, policy);
  const imported = new Set([
    ...pairs.map((pair) => pair.to),
    ...declarations.map((edge) => edge.to),
  ]);
  const literalPaths = policyLiteralPaths(policy);
  const scanned = new Set(
    scan.modules
      .filter((module) => module.entry_point === true)
      .map((module) => module.id),
  );

  const testImporters = testImportersOf(scan);
  const reached = reachedModules(scan, ids, imported, (id) =>
    isEntryPoint(id, literalPaths, entryPoints, scanned.has(id)),
  );

  return [...ids]
    .filter((id) => !reached.has(id))
    .sort(compare)
    .map((id): FindingRecord => {
      const importers = testImporters.get(id) ?? [];
      const base = {
        id: `orphan:${id}`,
        kind: "orphan",
        severity: "warning" as const,
        principle: "every-module-is-reachable",
      };

      if (importers.length === 0) {
        return {
          ...base,
          summary: `${id} is imported by no module and is not an entry point${libraryApiHint(id)}`,
          fix_pattern: "remove-or-wire-orphan",
          evidence: { modules: [id] },
        };
      }

      return {
        ...base,
        summary: testOnlySummary(id, importers),
        fix_pattern: "move-orphan-to-tests",
        evidence: { modules: [id], test_importers: importers },
      };
    });
}

function usedNames(edges: ScanEdge[]) {
  const named = new Map<string, Set<string>>();
  const whole = new Set<string>();

  for (const edge of edges) {
    if (isForeign(edge.to) || edge.from === edge.to) {
      continue;
    }

    if (edge.kind === "declares") {
      whole.add(edge.to);
    } else if (edge.kind === "depends") {
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

function usedThroughExpect(
  scan: Scan,
  ids: Set<string>,
  named: Map<string, Set<string>>,
  whole: Set<string>,
): (id: string, name: string) => boolean {
  const modules = new Map(scan.modules.map((module) => [module.id, module]));
  const called = new Set<string>();

  for (const call of scan.calls ?? []) {
    if (call.from !== call.to) {
      called.add(call.to);
    }
  }

  const actualNames = new Map<string, Set<string>>();

  for (const module of scan.modules) {
    if (!ids.has(module.id)) {
      continue;
    }

    for (const expectId of module.actual_of ?? []) {
      const held = actualNames.get(expectId) ?? new Set<string>();

      for (const member of module.members ?? []) {
        held.add(member.name);
      }

      actualNames.set(expectId, held);
    }
  }

  const through = (id: string, name: string, seen: Set<string>): boolean => {
    if (seen.has(id)) {
      return false;
    }

    seen.add(id);

    for (const expectId of modules.get(id)?.actual_of ?? []) {
      const expectModule = modules.get(expectId);

      if (
        !ids.has(expectId) ||
        !(expectModule?.members ?? []).some((member) => member.name === name)
      ) {
        continue;
      }

      if (
        whole.has(expectId) ||
        isUsed(name, named.get(expectId) ?? new Set<string>()) ||
        called.has(`${expectId}::${name}`) ||
        through(expectId, name, seen)
      ) {
        return true;
      }
    }

    return false;
  };

  return (id, name) =>
    (actualNames.get(id)?.has(name) === true && called.has(`${id}::${name}`)) ||
    through(id, name, new Set<string>());
}

export function unusedExportsFindings(
  scan: Scan,
  policy: Policy | null,
  entryPoints: string[],
): FindingRecord[] {
  const { edges, declarations, ids } = keptGraph(scan, policy?.ignore ?? []);
  const { named, whole } = usedNames([...edges, ...declarations]);
  const viaExpect = usedThroughExpect(scan, ids, named, whole);
  const literalPaths = policyLiteralPaths(policy);
  const testImporters = testImportersOf(scan);
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
      .filter((name) => !isUsed(name, used) && !viaExpect(module.id, name))
      .map((name) => first.get(name) as ScanMember);

    if (unused.length === 0) {
      continue;
    }

    const noun = unused.length === 1 ? "name" : "names";
    const names = unused.map((member) => member.name).join(", ");
    const importers = testImporters.get(module.id) ?? [];
    const testFiles = new Map<string, string[]>();

    for (const member of unused) {
      const files = importers
        .filter((importer) => isUsed(member.name, new Set(importer.names)))
        .map((importer) => importer.file);

      if (files.length > 0) {
        testFiles.set(member.name, files);
      }
    }

    const marked = unused
      .filter((member) => testFiles.has(member.name))
      .map((member) => ({
        name: member.name,
        testFiles: testFiles.get(member.name) as string[],
      }));

    findings.push({
      id: `unused_exports:${module.id}`,
      kind: "unused_exports",
      severity: "warning",
      principle: "export-only-what-is-used",
      summary: `${module.id} exports ${unused.length} ${noun} no other module imports: ${names}${marked.length > 0 ? unusedTestOnlyClause(marked) : ""}`,
      fix_pattern: "narrow-exports",
      evidence: {
        modules: [module.id],
        members: unused.map((member) => ({
          module: module.id,
          name: member.name,
          ...(module.kind === "module" && member.line !== undefined
            ? { file: module.id, lines: [member.line, member.line] }
            : {}),
          ...(testFiles.has(member.name)
            ? { test_files: testFiles.get(member.name) }
            : {}),
        })),
      },
    });
  }

  return findings.sort((a, b) => compare(a.id, b.id));
}

export function privateImportsFindings(
  scan: Scan,
  policy: Policy | null,
): FindingRecord[] {
  const { edges } = keptGraph(scan, policy?.ignore ?? []);
  const modules = new Map(scan.modules.map((module) => [module.id, module]));
  const byImporter = new Map<
    string,
    Map<
      string,
      { names: Map<string, ScanMember | undefined>; lines: Set<number> }
    >
  >();

  for (const edge of edges) {
    if (
      edge.kind !== "depends" ||
      edge.from === edge.to ||
      isForeign(edge.to) ||
      isTestFile(edge.from) ||
      edge.names === undefined
    ) {
      continue;
    }

    const importer = modules.get(edge.from);
    const owner = modules.get(edge.to);

    if (
      importer?.language !== "python" ||
      owner?.language !== "python" ||
      owner.members === undefined
    ) {
      continue;
    }

    const privateNames = new Map<string, ScanMember>();

    for (const name of edge.names) {
      const member = owner.members.find((candidate) => candidate.name === name);

      if (member !== undefined && member.exported === false) {
        privateNames.set(name, member);
      }
    }

    if (privateNames.size === 0) {
      continue;
    }

    const owners =
      byImporter.get(edge.from) ??
      new Map<
        string,
        { names: Map<string, ScanMember | undefined>; lines: Set<number> }
      >();
    const entry = owners.get(edge.to) ?? { names: new Map(), lines: new Set() };

    for (const [name, member] of privateNames) {
      entry.names.set(name, member);
    }

    entry.lines.add(edge.line);
    owners.set(edge.to, entry);
    byImporter.set(edge.from, owners);
  }

  const findings: FindingRecord[] = [];

  for (const [importer, owners] of byImporter) {
    const ownerIds = [...owners.keys()].sort(compare);
    const members: NonNullable<FindingRecord["evidence"]["members"]> = [];
    let count = 0;

    for (const ownerId of ownerIds) {
      const entry = owners.get(ownerId) as {
        names: Map<string, ScanMember | undefined>;
        lines: Set<number>;
      };

      for (const name of [...entry.names.keys()].sort(compare)) {
        const member = entry.names.get(name);

        count += 1;
        members.push({
          module: ownerId,
          name,
          ...(member?.line !== undefined
            ? { file: ownerId, lines: [member.line, member.line] }
            : {}),
        });
      }
    }

    const first = ownerIds.slice(0, 3).join(", ");
    const more = ownerIds.length > 3 ? ` and ${ownerIds.length - 3} more` : "";

    findings.push({
      id: `private_imports:${importer}`,
      kind: "private_imports",
      severity: "warning",
      principle: "information-hiding",
      summary: `${importer} imports ${count} private ${count === 1 ? "name" : "names"} from ${ownerIds.length} ${ownerIds.length === 1 ? "module" : "modules"} (${first}${more}) - information hiding (Parnas, 1972)`,
      evidence: {
        modules: [importer],
        members,
        edges: ownerIds.map((ownerId) => ({
          from: importer,
          to: ownerId,
          kind: "depends",
          lines: [...(owners.get(ownerId)?.lines ?? [])].sort((a, b) => a - b),
        })),
      },
    });
  }

  return findings.sort((a, b) => compare(a.id, b.id));
}
