import {
  compilePolicy,
  type Dependency,
  type Finding,
  type FindingMember,
  isForeign,
  keptGraph,
  type Member,
  type PolicyRule,
  type Repository,
} from "@recognizer/core";
import { isEntryPoint, isTestFile } from "./entry-points.js";
import { LONG_FUNCTION, measuredLength } from "./function-length.js";
import { principleOf } from "./principles.js";
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

const SUPERTYPE_KINDS = new Set(["inherits", "implements"]);

function reachedModules(
  repository: Repository,
  ids: Set<string>,
  imported: Set<string>,
  isEntry: (id: string) => boolean,
  supertypes: { from: string; to: string }[],
): Set<string> {
  const reached = new Set<string>();

  for (const id of ids) {
    if (imported.has(id) || isEntry(id)) {
      reached.add(id);
    }
  }

  const actuals = repository.files.filter(
    (file) => file.actualOf.length > 0 && ids.has(file.path),
  );
  let grew = true;

  while (grew) {
    grew = false;

    for (const file of actuals) {
      if (
        !reached.has(file.path) &&
        file.actualOf.some((expect) => reached.has(expect))
      ) {
        reached.add(file.path);
        grew = true;
      }
    }

    for (const { from, to } of supertypes) {
      if (reached.has(to) && !reached.has(from)) {
        reached.add(from);
        grew = true;
      }

      if (reached.has(from) && !reached.has(to)) {
        reached.add(to);
        grew = true;
      }
    }
  }

  return reached;
}

export function orphanFindings(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
  entryPoints: string[],
  entryAnnotations: string[],
): Finding[] {
  const { ids, edges, declarations } = keptGraph(
    repository,
    compilePolicy(policy).ignore,
  );
  const kotlin = new Set(
    repository.files
      .filter((file) => file.language === "kotlin")
      .map((file) => file.path),
  );
  const real = edges.filter(
    (edge) => edge.from !== edge.to && !isForeign(edge.to),
  );
  const supertypes = real
    .filter((edge) => SUPERTYPE_KINDS.has(edge.kind) && kotlin.has(edge.from))
    .map((edge) => ({ from: edge.from, to: edge.to }));
  const supertypePairs = new Set(
    supertypes.map((edge) => `${edge.from}\0${edge.to}`),
  );
  const imported = new Set([
    ...real
      .filter((edge) => !supertypePairs.has(`${edge.from}\0${edge.to}`))
      .map((edge) => edge.to),
    ...declarations.map((edge) => edge.to),
  ]);
  const policyEntry = compilePolicy(policy).entry;
  const scanned = new Set(
    repository.files
      .filter(
        (file) =>
          file.entryPoint ||
          file.annotations.some((name) => entryAnnotations.includes(name)),
      )
      .map((file) => file.path),
  );

  const testImporters = testImportersOf(repository);
  const reached = reachedModules(
    repository,
    ids,
    imported,
    (id) => isEntryPoint(id, policyEntry, entryPoints, scanned.has(id)),
    supertypes,
  );

  return [...ids]
    .filter((id) => !reached.has(id))
    .sort(compare)
    .map((id): Finding => {
      const importers = testImporters.get(id) ?? [];
      const base = {
        id: `orphan:${id}`,
        kind: "orphan",
        severity: "warning" as const,
        ...principleOf("dead-code"),
      };

      if (importers.length === 0) {
        return {
          ...base,
          summary: `${id} is imported by no file and is not an entry point${libraryApiHint(id)}`,
          fixPattern: "remove-or-wire-orphan",
          files: [id],
        };
      }

      return {
        ...base,
        summary: testOnlySummary(id, importers),
        fixPattern: "move-orphan-to-tests",
        files: [id],
        testImporters: importers,
      };
    });
}

function usedNames(edges: Dependency[]) {
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
    } else if (edge.toMember !== undefined) {
      const held = named.get(edge.to) ?? new Set<string>();

      held.add(edge.toMember);
      named.set(edge.to, held);
    }
  }

  return { named, whole };
}

function isUsed(name: string, used: Set<string>): boolean {
  return used.has(name) || used.has(name.split(".", 1)[0] as string);
}

function usedThroughExpect(
  repository: Repository,
  ids: Set<string>,
  named: Map<string, Set<string>>,
  whole: Set<string>,
): (id: string, name: string) => boolean {
  const modules = new Map(repository.files.map((file) => [file.path, file]));
  const called = new Set<string>();

  for (const call of repository.calls) {
    if (call.from !== call.to) {
      called.add(call.to);
    }
  }

  const actualNames = new Map<string, Set<string>>();

  for (const file of repository.files) {
    if (!ids.has(file.path)) {
      continue;
    }

    for (const expectId of file.actualOf) {
      const held = actualNames.get(expectId) ?? new Set<string>();

      for (const member of file.members) {
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

    for (const expectId of modules.get(id)?.actualOf ?? []) {
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
  repository: Repository,
  policy: readonly PolicyRule[] | null,
  entryPoints: string[],
): Finding[] {
  const { edges, declarations, ids } = keptGraph(
    repository,
    compilePolicy(policy).ignore,
  );
  const { named, whole } = usedNames([...edges, ...declarations]);
  const viaExpect = usedThroughExpect(repository, ids, named, whole);
  const policyEntry = compilePolicy(policy).entry;
  const testImporters = testImportersOf(repository);
  const findings: Finding[] = [];

  for (const module of repository.files) {
    if (
      !ids.has(module.path) ||
      whole.has(module.path) ||
      isEntryPoint(module.path, policyEntry, entryPoints, module.entryPoint)
    ) {
      continue;
    }

    const first = new Map<string, Member>();

    for (const member of module.members) {
      if (member.exported && !first.has(member.name)) {
        first.set(member.name, member);
      }
    }

    const used = named.get(module.path) ?? new Set<string>();
    const unused = [...first.keys()]
      .sort(compare)
      .filter((name) => !isUsed(name, used) && !viaExpect(module.path, name))
      .map((name) => first.get(name) as Member);

    if (unused.length === 0) {
      continue;
    }

    const noun = unused.length === 1 ? "name" : "names";
    const names = unused.map((member) => member.name).join(", ");
    const importers = testImporters.get(module.path) ?? [];
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
      id: `unused_exports:${module.path}`,
      kind: "unused_exports",
      severity: "warning",
      ...principleOf("information-hiding"),
      summary: `${module.path} exports ${unused.length} ${noun} no other file imports: ${names}${marked.length > 0 ? unusedTestOnlyClause(marked) : ""}`,
      fixPattern: "narrow-exports",
      files: [module.path],
      members: unused.map((member) => ({
        file: module.path,
        name: member.name,
        ...(module.kind === "source" && member.line !== undefined
          ? {
              sourceFile: module.path,
              lines: [member.line, member.line] as [number, number],
            }
          : {}),
        ...(testFiles.has(member.name)
          ? { testFiles: testFiles.get(member.name) }
          : {}),
      })),
    });
  }

  return findings.sort((a, b) => compare(a.id, b.id));
}

export function privateImportsFindings(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
): Finding[] {
  const { edges } = keptGraph(repository, compilePolicy(policy).ignore);
  const modules = new Map(repository.files.map((file) => [file.path, file]));
  const byImporter = new Map<
    string,
    Map<string, { names: Map<string, Member | undefined>; lines: Set<number> }>
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
      owner.members.length === 0
    ) {
      continue;
    }

    const privateNames = new Map<string, Member>();

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
        { names: Map<string, Member | undefined>; lines: Set<number> }
      >();
    const entry = owners.get(edge.to) ?? { names: new Map(), lines: new Set() };

    for (const [name, member] of privateNames) {
      entry.names.set(name, member);
    }

    entry.lines.add(edge.line);
    owners.set(edge.to, entry);
    byImporter.set(edge.from, owners);
  }

  const findings: Finding[] = [];

  for (const [importer, owners] of byImporter) {
    const ownerIds = [...owners.keys()].sort(compare);
    const members: FindingMember[] = [];
    let count = 0;

    for (const ownerId of ownerIds) {
      const entry = owners.get(ownerId) as {
        names: Map<string, Member | undefined>;
        lines: Set<number>;
      };

      for (const name of [...entry.names.keys()].sort(compare)) {
        const member = entry.names.get(name);

        count += 1;
        members.push({
          file: ownerId,
          name,
          ...(member?.line !== undefined
            ? {
                sourceFile: ownerId,
                lines: [member.line, member.line] as [number, number],
              }
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
      ...principleOf("information-hiding"),
      summary: `${importer} imports ${count} private ${count === 1 ? "name" : "names"} from ${ownerIds.length} ${ownerIds.length === 1 ? "file" : "files"} (${first}${more})`,
      files: [importer],
      members,
      dependencies: ownerIds.map((ownerId) => ({
        from: importer,
        to: ownerId,
        kind: "depends",
        lines: [...(owners.get(ownerId)?.lines ?? [])].sort((a, b) => a - b),
      })),
    });
  }

  return findings.sort((a, b) => compare(a.id, b.id));
}

interface MeasuredFunction {
  qualified: string;
  line?: number;
  endLine?: number;
  bodyLine?: number;
}

function functionsOf(members: readonly Member[]): MeasuredFunction[] {
  const functions: MeasuredFunction[] = [];

  for (const member of members) {
    if (member.kind === "function") {
      functions.push({
        qualified: member.name,
        line: member.line,
        endLine: member.endLine,
        bodyLine: member.bodyLine,
      });

      continue;
    }

    for (const method of member.methods ?? []) {
      functions.push({
        qualified: `${member.name}.${method.name}`,
        line: method.line,
        endLine: method.endLine,
        bodyLine: method.bodyLine,
      });
    }
  }

  return functions;
}

export function functionLengths(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
): Record<string, number> {
  const lengths: Record<string, number> = {};
  const { ids } = keptGraph(repository, compilePolicy(policy).ignore);

  for (const file of repository.files) {
    if (!ids.has(file.path) || isTestFile(file.path)) {
      continue;
    }

    for (const fn of functionsOf(file.members)) {
      const length = measuredLength(fn.line, fn.bodyLine, fn.endLine);

      if (length === null) {
        continue;
      }

      const key = `${file.path}::${fn.qualified}`;

      lengths[key] = Math.max(lengths[key] ?? 0, length);
    }
  }

  return lengths;
}

export function longFunctionFindings(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
  limit: number = LONG_FUNCTION,
): Finding[] {
  const { ids } = keptGraph(repository, compilePolicy(policy).ignore);
  const findings: Finding[] = [];

  for (const module of repository.files) {
    if (!ids.has(module.path) || isTestFile(module.path)) {
      continue;
    }

    const functions = functionsOf(module.members);
    const counts = new Map<string, number>();

    for (const fn of functions) {
      counts.set(fn.qualified, (counts.get(fn.qualified) ?? 0) + 1);
    }

    for (const fn of functions) {
      const length = measuredLength(fn.line, fn.bodyLine, fn.endLine);

      if (
        length === null ||
        length <= limit ||
        fn.line === undefined ||
        fn.endLine === undefined
      ) {
        continue;
      }

      const identity =
        (counts.get(fn.qualified) ?? 0) > 1
          ? `${module.path}::${fn.qualified}@${fn.line}`
          : `${module.path}::${fn.qualified}`;

      findings.push({
        id: `long_function:${identity}`,
        kind: "long_function",
        severity: "warning",
        ...principleOf("small-functions"),
        summary:
          fn.bodyLine === undefined
            ? `${fn.qualified} is ${length} lines, over the limit of ${limit}`
            : `${fn.qualified} has a ${length}-line body, over the limit of ${limit}`,
        files: [module.path],
        members: [
          {
            file: module.path,
            name: fn.qualified,
            sourceFile: module.path,
            lines: [fn.line, fn.endLine],
          },
        ],
        measures: {
          lines: length,
          limit,
          ...(fn.bodyLine === undefined ? {} : { body_line: fn.bodyLine }),
          ...(limit === LONG_FUNCTION ? {} : { published: LONG_FUNCTION }),
        },
      });
    }
  }

  return findings.sort((a, b) => compare(a.id, b.id));
}
