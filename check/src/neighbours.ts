import type { Scan, ScanEdge } from "./scan.js";

export type NeighbourRow = {
  id: string;
  names: string[];
  private: boolean;
  inferred: boolean;
};

export type FolderGroup = { folder: string; rows: NeighbourRow[] };

export type NeighbourSets = {
  uses: Map<string, Set<string>>;
  usedBy: Map<string, Set<string>>;
};

export type NeighbourCounts = { uses: number; usedBy: number };

const compare = (a: string, b: string) => a.localeCompare(b);

export function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function moduleLabel(id: string): string {
  const name = lastSegment(id);
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(0, dot) : name;
}

export function folderChain(id: string): string[] {
  const parts = id.split("/");

  return parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function under(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

export function folderOf(id: string): string {
  return id.slice(0, Math.max(0, id.lastIndexOf("/")));
}

export function edgeNames(edge: ScanEdge): string[] {
  if (edge.names && edge.names.length > 0) {
    return edge.names;
  }

  return edge.to_member === undefined ? [] : [edge.to_member];
}

export function moduleNames(scans: Scan[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const scan of scans) {
    for (const module of scan.modules) {
      if (!seen.has(module.id)) {
        seen.add(module.id);
        names.push(module.id);
      }
    }
  }

  return names;
}

export function membersOf(scans: Scan[]): Map<string, Map<string, boolean>> {
  const members = new Map<string, Map<string, boolean>>();

  for (const scan of scans) {
    for (const module of scan.modules) {
      if (module.members) {
        members.set(
          module.id,
          new Map(module.members.map((m) => [m.name, m.exported])),
        );
      }
    }
  }

  return members;
}

export function neighbourSets(
  edges: ScanEdge[],
  known: Set<string>,
): NeighbourSets {
  const uses = new Map<string, Set<string>>();
  const usedBy = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (edge.from === edge.to || !known.has(edge.from) || !known.has(edge.to)) {
      continue;
    }

    uses.set(edge.from, (uses.get(edge.from) ?? new Set()).add(edge.to));
    usedBy.set(edge.to, (usedBy.get(edge.to) ?? new Set()).add(edge.from));
  }

  return { uses, usedBy };
}

export function moduleCounts(sets: NeighbourSets, id: string): NeighbourCounts {
  return {
    uses: sets.uses.get(id)?.size ?? 0,
    usedBy: sets.usedBy.get(id)?.size ?? 0,
  };
}

export function folderCounts(
  sets: NeighbourSets,
  modules: string[],
  folder: string,
): NeighbourCounts {
  const reached = new Set<string>();
  const reaching = new Set<string>();

  for (const id of modules.filter((module) => under(module, folder))) {
    for (const other of sets.uses.get(id) ?? []) {
      if (!under(other, folder)) {
        reached.add(other);
      }
    }

    for (const other of sets.usedBy.get(id) ?? []) {
      if (!under(other, folder)) {
        reaching.add(other);
      }
    }
  }

  return { uses: reached.size, usedBy: reaching.size };
}

function rowsFrom(
  scans: Scan[],
  modules: string[],
  pick: (edge: ScanEdge) => string | null,
): NeighbourRow[] {
  const known = new Set(modules);
  const members = membersOf(scans);
  const byId = new Map<string, ScanEdge[]>();

  for (const scan of scans) {
    for (const edge of scan.edges) {
      if (
        edge.from === edge.to ||
        !known.has(edge.from) ||
        !known.has(edge.to)
      ) {
        continue;
      }

      const id = pick(edge);

      if (id !== null) {
        byId.set(id, [...(byId.get(id) ?? []), edge]);
      }
    }
  }

  return [...byId.entries()]
    .map(([id, edges]) => {
      const names = new Set<string>();
      let isPrivate = false;

      for (const edge of edges) {
        for (const name of edgeNames(edge)) {
          names.add(name);
          isPrivate = isPrivate || members.get(edge.to)?.get(name) === false;
        }
      }

      return {
        id,
        names: [...names].sort(compare),
        private: isPrivate,
        inferred: edges.every((edge) => edge.inferred !== undefined),
      };
    })
    .sort((a, b) => compare(a.id, b.id));
}

export function usesOf(
  scans: Scan[],
  modules: string[],
  id: string,
): NeighbourRow[] {
  return rowsFrom(scans, modules, (edge) =>
    edge.from === id ? edge.to : null,
  );
}

export function usedByOf(
  scans: Scan[],
  modules: string[],
  id: string,
): NeighbourRow[] {
  return rowsFrom(scans, modules, (edge) =>
    edge.to === id ? edge.from : null,
  );
}

export function folderUses(
  scans: Scan[],
  modules: string[],
  folder: string,
): NeighbourRow[] {
  return rowsFrom(scans, modules, (edge) =>
    under(edge.from, folder) && !under(edge.to, folder) ? edge.to : null,
  );
}

export function folderUsedBy(
  scans: Scan[],
  modules: string[],
  folder: string,
): NeighbourRow[] {
  return rowsFrom(scans, modules, (edge) =>
    under(edge.to, folder) && !under(edge.from, folder) ? edge.from : null,
  );
}

export function groupByFolder(rows: NeighbourRow[]): FolderGroup[] {
  const byFolder = new Map<string, NeighbourRow[]>();

  for (const row of rows) {
    const folder = folderOf(row.id);

    byFolder.set(folder, [...(byFolder.get(folder) ?? []), row]);
  }

  return [...byFolder.keys()].sort(compare).map((folder) => ({
    folder,
    rows: byFolder.get(folder) as NeighbourRow[],
  }));
}
