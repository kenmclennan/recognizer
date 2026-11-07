import { type Matcher, matchesAny } from "./glob.js";
import type { Scan, ScanEdge } from "./scan.js";

const FOREIGN_PREFIX = "foreign:";

export function isForeign(id: string): boolean {
  return id.startsWith(FOREIGN_PREFIX);
}

export function dependencyEdges<T extends { kind: string }>(
  edges: readonly T[],
): T[] {
  return edges.filter((edge) => edge.kind !== "declares");
}

export function keptGraph(scan: Scan, ignore: Matcher[]) {
  const dropped = (id: string) => !isForeign(id) && matchesAny(ignore, id);

  const ids = new Set<string>();

  for (const module of scan.modules) {
    if (!dropped(module.id)) {
      ids.add(module.id);
    }
  }

  const kept: ScanEdge[] = scan.edges.filter(
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
