import { type Matcher, matchesAny } from "./glob.js";
import type { Scan, ScanEdge } from "./scan.js";

const FOREIGN_PREFIX = "foreign:";

export function isForeign(id: string): boolean {
  return id.startsWith(FOREIGN_PREFIX);
}

export function keptGraph(scan: Scan, ignore: Matcher[]) {
  const dropped = (id: string) => !isForeign(id) && matchesAny(ignore, id);

  const ids = new Set<string>();

  for (const module of scan.modules) {
    if (!dropped(module.id)) {
      ids.add(module.id);
    }
  }

  const edges: ScanEdge[] = scan.edges.filter(
    (edge) =>
      edge.inferred === undefined && !dropped(edge.from) && !dropped(edge.to),
  );

  for (const edge of edges) {
    ids.add(edge.from);

    if (!isForeign(edge.to)) {
      ids.add(edge.to);
    }
  }

  return { edges, ids };
}
