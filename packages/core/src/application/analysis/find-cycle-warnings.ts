import type { Warning } from "../../domain/analysis/warning.js";
import type { PolicyRule } from "../../domain/policy-rule.js";
import type { Repository } from "../../domain/repository.js";
import { compilePolicy } from "./compile-policy.js";
import { isForeign, keptGraph } from "./graph.js";
import { sealedGroups } from "./internal/sealed-hierarchy.js";
import { strongComponents } from "./internal/strong-components.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function findCycleWarnings(
  repository: Repository,
  rules: readonly PolicyRule[],
): Warning[] {
  const { edges, ids } = keptGraph(repository, compilePolicy(rules).ignore);
  const internal = new Map<string, Set<string>>();

  for (const id of ids) {
    internal.set(id, new Set());
  }

  for (const edge of edges) {
    if (edge.from === edge.to || isForeign(edge.to)) {
      continue;
    }

    internal.get(edge.from)?.add(edge.to);
  }

  const sorted = [...ids].sort(byCodeUnit);
  const groups = sealedGroups(repository, edges);
  const groupOf = (id: string) => groups.get(id) ?? id;
  const crossing = new Map<string, Set<string>>();
  const groupSuccessors = new Map<string, Set<string>>();

  for (const id of sorted) {
    crossing.set(id, new Set());
    groupSuccessors.set(groupOf(id), new Set());
  }

  for (const id of sorted) {
    for (const to of internal.get(id) ?? []) {
      if (groupOf(to) !== groupOf(id)) {
        crossing.get(id)?.add(to);
        groupSuccessors.get(groupOf(id))?.add(groupOf(to));
      }
    }
  }

  const groupIds = [...groupSuccessors.keys()].sort(byCodeUnit);
  const successors = new Map<string, string[]>();

  for (const group of groupIds) {
    successors.set(
      group,
      [...(groupSuccessors.get(group) ?? [])].sort(byCodeUnit),
    );
  }

  return strongComponents(groupIds, successors)
    .filter((component) => component.length >= 2)
    .map((component): Warning => {
      const members = new Set(component);
      const inside = sorted.flatMap((from) =>
        members.has(groupOf(from))
          ? [...(crossing.get(from) ?? [])]
              .filter((to) => members.has(groupOf(to)))
              .sort(byCodeUnit)
              .map((to) => ({ from, to }))
          : [],
      );
      const files = [
        ...new Set(inside.flatMap((edge) => [edge.from, edge.to])),
      ].sort(byCodeUnit);

      return {
        kind: "cycle",
        principle: "levelization",
        fixPattern: "break-cycle",
        summary: `cycle of ${files.length} files: ${files.join(", ")}`,
        files,
        dependencies: inside,
      };
    })
    .sort((a, b) => byCodeUnit(a.files[0] ?? "", b.files[0] ?? ""));
}
