import { isEntryPoint } from "../../domain/analysis/entry-points.js";
import {
  testImportersOf,
  unusedTestOnlyClause,
} from "../../domain/analysis/test-importers.js";
import { type Dependency, Library } from "../../domain/dependency.js";
import type { Member } from "../../domain/member.js";
import { PolicyRule } from "../../domain/policy-rule.js";
import type { Repository } from "../../domain/repository.js";
import { Warning } from "../../domain/warning.js";

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function usedNames(edges: Dependency[]) {
  const named = new Map<string, Set<string>>();
  const whole = new Set<string>();

  for (const edge of edges) {
    if (Library.owns(edge.to) || edge.from === edge.to) {
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

export function unusedExportsWarnings(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
  entryPoints: string[],
): Warning[] {
  const { edges, declarations, ids } = repository.graphKeeping(policy);
  const { named, whole } = usedNames([...edges, ...declarations]);
  const viaExpect = usedThroughExpect(repository, ids, named, whole);
  const policyEntry = PolicyRule.entries(policy);
  const testImporters = testImportersOf(repository);
  const findings: Warning[] = [];

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

    findings.push(
      new Warning({
        id: `unused_exports:${module.path}`,
        kind: "unused_exports",
        principle: "information-hiding",
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
      }),
    );
  }

  return findings.sort((a, b) => compare(a.id, b.id));
}
