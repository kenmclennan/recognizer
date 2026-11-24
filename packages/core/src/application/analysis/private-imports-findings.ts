import { isTestFile } from "../../domain/analysis/entry-points.js";
import { Library } from "../../domain/dependency.js";
import type { FindingMember } from "../../domain/finding.js";
import type { Member } from "../../domain/member.js";
import type { PolicyRule } from "../../domain/policy-rule.js";
import type { Repository } from "../../domain/repository.js";
import { Warning } from "../../domain/warning.js";

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function privateImportsWarnings(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
): Warning[] {
  const { edges } = repository.graphKeeping(policy);
  const modules = new Map(repository.files.map((file) => [file.path, file]));
  const byImporter = new Map<
    string,
    Map<string, { names: Map<string, Member | undefined>; lines: Set<number> }>
  >();

  for (const edge of edges) {
    const importedNames =
      edge.kind === "depends"
        ? edge.names
        : (edge.kind === "inherits" || edge.kind === "implements") &&
            edge.toMember !== undefined
          ? [edge.toMember]
          : undefined;

    if (
      importedNames === undefined ||
      edge.from === edge.to ||
      Library.owns(edge.to) ||
      isTestFile(edge.from)
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

    for (const name of importedNames) {
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

  const findings: Warning[] = [];

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

    findings.push(
      new Warning({
        id: `private_imports:${importer}`,
        kind: "private_imports",
        principle: "information-hiding",
        summary: `${importer} imports ${count} private ${count === 1 ? "name" : "names"} from ${ownerIds.length} ${ownerIds.length === 1 ? "file" : "files"} (${first}${more})`,
        files: [importer],
        members,
        dependencies: ownerIds.map((ownerId) => ({
          from: importer,
          to: ownerId,
          kind: "depends",
          lines: [...(owners.get(ownerId)?.lines ?? [])].sort((a, b) => a - b),
        })),
      }),
    );
  }

  return findings.sort((a, b) => compare(a.id, b.id));
}
