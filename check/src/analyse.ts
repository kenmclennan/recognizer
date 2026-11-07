import type { Matcher } from "./glob.js";
import { isForeign, keptGraph } from "./graph.js";
import { hubUse } from "./hub-use.js";
import type { Scan, ScanEdge } from "./scan.js";

export interface Thresholds {
  hub: number;
}

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

export interface CycleWarning {
  id: "cycle";
  principle: "no-cycles";
  fix_pattern: "break-cycle";
  summary: string;
  evidence: { modules: string[]; edges: { from: string; to: string }[] };
}

export interface HubWarning {
  id: "hub";
  principle: "interfaces-are-narrow-and-explicit";
  fix_pattern: "split-hub";
  summary: string;
  evidence: {
    module: string;
    fan_in: number;
    fan_out: number;
    threshold: number;
    lines?: number;
    members?: number;
    used_by: { module: string; names: string[] }[];
  };
}

export type Warning = CycleWarning | HubWarning;

export interface Analysis {
  thresholds: Thresholds;
  warnings: Warning[];
  metrics: ModuleMetrics[];
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function strongComponents(
  nodes: string[],
  successors: Map<string, string[]>,
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const visit = (node: string) => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of successors.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0));
      }
    }

    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string | undefined;

      do {
        member = stack.pop();

        if (member === undefined) {
          break;
        }

        onStack.delete(member);
        component.push(member);
      } while (member !== node);

      components.push(component);
    }
  };

  for (const node of nodes) {
    if (!index.has(node)) {
      visit(node);
    }
  }

  return components;
}

export function analyse(
  scan: Scan,
  thresholds: Thresholds,
  ignore: Matcher[] = [],
): Analysis {
  const { edges, ids } = keptGraph(scan, ignore);
  const kinds = new Map<string, ModuleMetrics["kind"]>();

  for (const module of scan.modules) {
    kinds.set(module.id, module.kind);
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

  const successors = new Map<string, string[]>();

  for (const id of sorted) {
    successors.set(id, [...(internal.get(id) ?? [])].sort(byCodeUnit));
  }

  const cycles: CycleWarning[] = strongComponents(sorted, successors)
    .filter((component) => component.length >= 2)
    .map((component): CycleWarning => {
      const modules = [...component].sort(byCodeUnit);
      const members = new Set(modules);
      const inside = modules.flatMap((from) =>
        (successors.get(from) ?? [])
          .filter((to) => members.has(to))
          .map((to) => ({ from, to })),
      );

      return {
        id: "cycle",
        principle: "no-cycles",
        fix_pattern: "break-cycle",
        summary: `cycle of ${modules.length} modules: ${modules.join(", ")}`,
        evidence: { modules, edges: inside },
      };
    })
    .sort((a, b) =>
      byCodeUnit(a.evidence.modules[0] ?? "", b.evidence.modules[0] ?? ""),
    );

  const modulesById = new Map(
    scan.modules.map((module) => [module.id, module]),
  );

  const edgesByTarget = new Map<string, ScanEdge[]>();

  for (const edge of edges) {
    if (edge.from !== edge.to && !isForeign(edge.to)) {
      edgesByTarget.set(edge.to, [...(edgesByTarget.get(edge.to) ?? []), edge]);
    }
  }

  const hubs: HubWarning[] = metrics
    .filter(
      (row) => row.fan_in >= thresholds.hub && row.fan_out >= thresholds.hub,
    )
    .map((row): HubWarning => {
      const use = hubUse(
        edgesByTarget.get(row.id) ?? [],
        modulesById.get(row.id) ?? { id: row.id, kind: row.kind },
        incoming.get(row.id) ?? new Set(),
      );

      const size =
        use.lines !== undefined && use.members !== undefined
          ? `; it is ${use.lines} lines with ${use.members} members`
          : use.members !== undefined
            ? `; it has ${use.members} members`
            : use.lines !== undefined
              ? `; it is ${use.lines} lines`
              : "";

      return {
        id: "hub",
        principle: "interfaces-are-narrow-and-explicit",
        fix_pattern: "split-hub",
        summary: `${row.id} is imported by ${row.fan_in} modules and imports ${row.fan_out} (at least ${thresholds.hub} on both)${size}`,
        evidence: {
          module: row.id,
          fan_in: row.fan_in,
          fan_out: row.fan_out,
          threshold: thresholds.hub,
          ...(use.lines !== undefined ? { lines: use.lines } : {}),
          ...(use.members !== undefined ? { members: use.members } : {}),
          used_by: use.used_by,
        },
      };
    });

  return { thresholds, warnings: [...cycles, ...hubs], metrics };
}
