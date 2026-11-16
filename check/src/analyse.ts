import type { Matcher } from "./glob.js";
import { isForeign, keptGraph } from "./graph.js";
import type { Scan } from "./scan.js";
import { sealedGroups } from "./sealed-hierarchy.js";

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
  principle: "levelization";
  fix_pattern: "break-cycle";
  summary: string;
  evidence: { modules: string[]; edges: { from: string; to: string }[] };
}

export type Warning = CycleWarning;

export interface Analysis {
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

export function analyse(scan: Scan, ignore: Matcher[] = []): Analysis {
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

  const groups = sealedGroups(scan, edges);
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

  const cycles: CycleWarning[] = strongComponents(groupIds, successors)
    .filter((component) => component.length >= 2)
    .map((component): CycleWarning => {
      const members = new Set(component);
      const inside = sorted.flatMap((from) =>
        members.has(groupOf(from))
          ? [...(crossing.get(from) ?? [])]
              .filter((to) => members.has(groupOf(to)))
              .sort(byCodeUnit)
              .map((to) => ({ from, to }))
          : [],
      );
      const modules = [
        ...new Set(inside.flatMap((edge) => [edge.from, edge.to])),
      ].sort(byCodeUnit);

      return {
        id: "cycle",
        principle: "levelization",
        fix_pattern: "break-cycle",
        summary: `cycle of ${modules.length} modules: ${modules.join(", ")}`,
        evidence: { modules, edges: inside },
      };
    })
    .sort((a, b) =>
      byCodeUnit(a.evidence.modules[0] ?? "", b.evidence.modules[0] ?? ""),
    );

  return { warnings: cycles, metrics };
}
