import type { Dependency } from "../../domain/dependency.js";
import type { Repository } from "../../domain/repository.js";
import { type Matcher, matchesAny } from "./glob.js";

const FOREIGN_PREFIX = "foreign:";

export function isForeign(id: string): boolean {
  return id.startsWith(FOREIGN_PREFIX);
}

export function dependencyEdges<T extends { kind: string }>(
  edges: readonly T[],
): T[] {
  return edges.filter((edge) => edge.kind !== "declares");
}

export function keptGraph(repository: Repository, ignore: readonly Matcher[]) {
  const dropped = (id: string) => !isForeign(id) && matchesAny(ignore, id);

  const ids = new Set<string>();

  for (const file of repository.files) {
    if (!dropped(file.path)) {
      ids.add(file.path);
    }
  }

  const kept: Dependency[] = repository.dependencies.filter(
    (edge) =>
      edge.inferred === undefined && !dropped(edge.from) && !dropped(edge.to),
  );
  const edges = dependencyEdges(kept);
  const declarations = kept.filter((edge) => edge.kind === "declares");

  for (const edge of edges) {
    ids.add(edge.from);

    if (!isForeign(edge.to)) {
      ids.add(edge.to);
    }
  }

  return { edges, declarations, ids };
}
