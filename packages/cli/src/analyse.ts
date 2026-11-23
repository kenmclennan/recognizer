import {
  isForeign,
  keptGraph,
  type Matcher,
  type Repository,
} from "@recognizer/core";

export interface ModuleMetrics {
  id: string;
  kind: "module" | "package" | "interface";
  fan_in: number;
  fan_out: number;
  afferent: number;
  efferent: number;
  instability: number | null;
  abstractness: 0 | 1;
}

export interface Analysis {
  metrics: ModuleMetrics[];
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function analyse(
  repository: Repository,
  ignore: readonly Matcher[] = [],
): Analysis {
  const { edges, ids } = keptGraph(repository, ignore);
  const kinds = new Map<string, ModuleMetrics["kind"]>();

  for (const file of repository.files) {
    kinds.set(file.path, file.kind === "source" ? "module" : file.kind);
  }

  const internal = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();

  for (const id of ids) {
    internal.set(id, new Set());
    incoming.set(id, new Set());
  }

  for (const edge of edges) {
    if (edge.from === edge.to) {
      continue;
    }

    if (isForeign(edge.to)) {
      continue;
    }

    internal.get(edge.from)?.add(edge.to);
    incoming.get(edge.to)?.add(edge.from);
  }

  const sorted = [...ids].sort(byCodeUnit);

  const metrics = sorted.map((id): ModuleMetrics => {
    const kind = kinds.get(id) ?? "module";
    const fanIn = incoming.get(id)?.size ?? 0;
    const fanOut = internal.get(id)?.size ?? 0;
    const efferent = fanOut;
    const total = fanIn + efferent;

    return {
      id,
      kind,
      fan_in: fanIn,
      fan_out: fanOut,
      afferent: fanIn,
      efferent,
      instability:
        total === 0 ? null : Math.round((efferent / total) * 10000) / 10000,
      abstractness: kind === "interface" ? 1 : 0,
    };
  });

  return { metrics };
}
