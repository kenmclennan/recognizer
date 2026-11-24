import { isEntryPoint } from "../../domain/analysis/entry-points.js";
import type { LanguageBehaviour } from "../../domain/analysis/language-behaviour.js";
import {
  libraryApiHint,
  testImportersOf,
  testOnlySummary,
} from "../../domain/analysis/test-importers.js";
import { Library } from "../../domain/dependency.js";
import { PolicyRule } from "../../domain/policy-rule.js";
import type { Repository } from "../../domain/repository.js";
import { Warning } from "../../domain/warning.js";

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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

export function orphanWarnings(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
  entryPoints: string[],
  entryAnnotations: string[],
  behaviour: LanguageBehaviour,
): Warning[] {
  const { ids, edges, declarations } = repository.graphKeeping(policy);
  const linked = new Set(
    repository.files
      .filter((file) => behaviour.linksSupertypes(file.language))
      .map((file) => file.path),
  );
  const real = edges.filter(
    (edge) => edge.from !== edge.to && !Library.owns(edge.to),
  );
  const supertypes = real
    .filter((edge) => SUPERTYPE_KINDS.has(edge.kind) && linked.has(edge.from))
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
  const policyEntry = PolicyRule.entries(policy);
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
    (id) =>
      isEntryPoint(id, policyEntry, entryPoints, scanned.has(id), behaviour),
    supertypes,
  );

  return [...ids]
    .filter((id) => !reached.has(id))
    .sort(compare)
    .map((id): Warning => {
      const importers = testImporters.get(id) ?? [];
      const base = {
        id: `orphan:${id}`,
        kind: "orphan" as const,
        principle: "dead-code",
      };

      if (importers.length === 0) {
        return new Warning({
          ...base,
          summary: `${id} is imported by no file and is not an entry point${libraryApiHint(id)}`,
          fixPattern: "remove-or-wire-orphan",
          files: [id],
        });
      }

      return new Warning({
        ...base,
        summary: testOnlySummary(id, importers),
        fixPattern: "move-orphan-to-tests",
        files: [id],
        testImporters: importers,
      });
    });
}
