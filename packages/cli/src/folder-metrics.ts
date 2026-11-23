import {
  Library,
  type Member,
  type PolicyRule,
  type Repository,
} from "@recognizer/core";
import { folderOf } from "./structure-warnings.js";

export interface FolderMetrics {
  id: string;
  modules: number;
  afferent: number;
  efferent: number;
  instability: number | null;
  exported_members: number;
  abstract_members: number;
  abstractness: number | null;
  distance: number | null;
}

function figure(value: number | null): string {
  return value === null ? "unknown" : value.toFixed(2);
}

export function metricsLine(row: FolderMetrics): string {
  return [
    `I ${figure(row.instability)}`,
    `A ${figure(row.abstractness)}`,
    `D ${figure(row.distance)}`,
  ].join(" \u00b7 ");
}

export function metricsTable(row: FolderMetrics): [string, string][] {
  return [
    ["Files", String(row.modules)],
    ["Afferent coupling (Ca)", String(row.afferent)],
    ["Efferent coupling (Ce)", String(row.efferent)],
    ["Instability (I)", figure(row.instability)],
    ["Abstractness (A)", figure(row.abstractness)],
    ["Distance (D)", figure(row.distance)],
  ];
}

export interface FolderMeasures {
  rows: FolderMetrics[];
  modulesOf: Map<string, string[]>;
}

export function pairKey(source: string, target: string): string {
  return `${source}\0${target}`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function isAbstract(member: Member): boolean {
  if (member.kind === "interface") {
    return true;
  }

  return (
    (member.kind === "class" || member.kind === "type") &&
    ((member.tags ?? []) as string[]).includes("abstract")
  );
}

export function measureFolders(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
): FolderMeasures {
  const ids = new Set<string>();
  const members = new Map<string, readonly Member[]>();
  const seenEdges = new Set<string>();
  const edges: { from: string; to: string }[] = [];

  const kept = repository.graphKeeping(policy);

  for (const id of kept.ids) {
    ids.add(id);
  }

  for (const file of repository.files) {
    if (kept.ids.has(file.path) && !members.has(file.path)) {
      members.set(file.path, file.members);
    }
  }

  for (const edge of kept.edges) {
    const key = pairKey(edge.from, edge.to);

    if (edge.from !== edge.to && !seenEdges.has(key)) {
      seenEdges.add(key);
      edges.push({ from: edge.from, to: edge.to });
    }
  }

  const byFolder = new Map<string, string[]>();

  for (const id of ids) {
    const folder = folderOf(id);

    byFolder.set(folder, [...(byFolder.get(folder) ?? []), id]);
  }

  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();

  const add = (map: Map<string, Set<string>>, folder: string, id: string) => {
    const held = map.get(folder) ?? new Set<string>();

    held.add(id);
    map.set(folder, held);
  };

  for (const edge of edges) {
    const source = folderOf(edge.from);

    if (Library.owns(edge.to)) {
      continue;
    }

    const target = folderOf(edge.to);

    if (source === target) {
      continue;
    }

    add(outgoing, source, edge.from);
    add(incoming, target, edge.from);
  }

  const rows = [...byFolder.keys()].sort(compare).map((folder) => {
    const held = byFolder.get(folder) as string[];
    const exported = held
      .flatMap((id) => members.get(id) ?? [])
      .filter((member) => member.exported);
    const abstractCount = exported.filter(isAbstract).length;
    const afferent = incoming.get(folder)?.size ?? 0;
    const efferent = outgoing.get(folder)?.size ?? 0;
    const rawI =
      afferent + efferent === 0 ? null : efferent / (afferent + efferent);
    const rawA = exported.length === 0 ? null : abstractCount / exported.length;

    return {
      id: folder,
      modules: held.length,
      afferent,
      efferent,
      instability: rawI === null ? null : round(rawI),
      exported_members: exported.length,
      abstract_members: abstractCount,
      abstractness: rawA === null ? null : round(rawA),
      distance:
        rawI === null || rawA === null
          ? null
          : round(Math.abs(rawA + rawI - 1)),
    };
  });

  const modulesOf = new Map(
    [...byFolder].map(([folder, held]) => [folder, [...held].sort(compare)]),
  );

  return { rows, modulesOf };
}
