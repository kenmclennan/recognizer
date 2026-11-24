import type { Dependency } from "./dependency.js";
import { File } from "./file.js";
import { Folder } from "./folder.js";
import type { Repository } from "./repository.js";

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

export type PathStep = Omit<NeighbourRow, "id"> & { from: string; to: string };

const compare = (a: string, b: string) => a.localeCompare(b);

export class Neighbours {
  constructor(
    private readonly repository: Repository,
    private readonly modules: string[] = Neighbours.moduleNames(repository),
  ) {}

  static moduleLabel(id: string): string {
    const name = File.nameOf(id);
    const dot = name.lastIndexOf(".");

    return dot > 0 ? name.slice(0, dot) : name;
  }

  static under(path: string, folder: string): boolean {
    return path === folder || path.startsWith(`${folder}/`);
  }

  static edgeNames(edge: Dependency): string[] {
    if (edge.names && edge.names.length > 0) {
      return [...edge.names];
    }

    return edge.toMember === undefined ? [] : [edge.toMember];
  }

  static moduleNames(repository: Repository): string[] {
    const names: string[] = [];
    const seen = new Set<string>();

    for (const file of repository.files) {
      if (!seen.has(file.path)) {
        seen.add(file.path);
        names.push(file.path);
      }
    }

    return names;
  }

  static membersOf(repository: Repository): Map<string, Map<string, boolean>> {
    const members = new Map<string, Map<string, boolean>>();

    for (const file of repository.files) {
      members.set(
        file.path,
        new Map(file.members.map((m) => [m.name, m.exported])),
      );
    }

    return members;
  }

  static neighbourSets(
    edges: readonly Dependency[],
    known: Set<string>,
  ): NeighbourSets {
    const uses = new Map<string, Set<string>>();
    const usedBy = new Map<string, Set<string>>();

    for (const edge of edges) {
      if (
        edge.from === edge.to ||
        !known.has(edge.from) ||
        !known.has(edge.to)
      ) {
        continue;
      }

      uses.set(edge.from, (uses.get(edge.from) ?? new Set()).add(edge.to));
      usedBy.set(edge.to, (usedBy.get(edge.to) ?? new Set()).add(edge.from));
    }

    return { uses, usedBy };
  }

  static moduleCounts(sets: NeighbourSets, id: string): NeighbourCounts {
    return {
      uses: sets.uses.get(id)?.size ?? 0,
      usedBy: sets.usedBy.get(id)?.size ?? 0,
    };
  }

  static folderCounts(
    sets: NeighbourSets,
    modules: string[],
    folder: string,
  ): NeighbourCounts {
    const reached = new Set<string>();
    const reaching = new Set<string>();

    for (const id of modules.filter((module) =>
      Neighbours.under(module, folder),
    )) {
      for (const other of sets.uses.get(id) ?? []) {
        if (!Neighbours.under(other, folder)) {
          reached.add(other);
        }
      }

      for (const other of sets.usedBy.get(id) ?? []) {
        if (!Neighbours.under(other, folder)) {
          reaching.add(other);
        }
      }
    }

    return { uses: reached.size, usedBy: reaching.size };
  }

  static groupByFolder(rows: NeighbourRow[]): FolderGroup[] {
    const byFolder = new Map<string, NeighbourRow[]>();

    for (const row of rows) {
      const folder = Folder.containing(row.id);

      byFolder.set(folder, [...(byFolder.get(folder) ?? []), row]);
    }

    return [...byFolder.keys()].sort(compare).map((folder) => ({
      folder,
      rows: byFolder.get(folder) as NeighbourRow[],
    }));
  }

  usesOf(id: string): NeighbourRow[] {
    return this.rowsFrom((edge) => (edge.from === id ? edge.to : null));
  }

  usedByOf(id: string): NeighbourRow[] {
    return this.rowsFrom((edge) => (edge.to === id ? edge.from : null));
  }

  folderUses(folder: string): NeighbourRow[] {
    return this.rowsFrom((edge) =>
      Neighbours.under(edge.from, folder) && !Neighbours.under(edge.to, folder)
        ? edge.to
        : null,
    );
  }

  folderUsedBy(folder: string): NeighbourRow[] {
    return this.rowsFrom((edge) =>
      Neighbours.under(edge.to, folder) && !Neighbours.under(edge.from, folder)
        ? edge.from
        : null,
    );
  }

  shortestPath(from: string, to: string): PathStep[] | null {
    if (from === to) {
      return [];
    }

    const arrived = new Map<string, PathStep>();
    const seen = new Set([from]);
    let frontier = [from];

    while (frontier.length > 0) {
      const next: string[] = [];

      for (const id of frontier) {
        for (const row of this.usesOf(id)) {
          if (seen.has(row.id)) {
            continue;
          }

          seen.add(row.id);
          const { id: target, ...rest } = row;

          arrived.set(target, { ...rest, from: id, to: target });
          next.push(row.id);
        }
      }

      if (seen.has(to)) {
        const steps: PathStep[] = [];

        for (let at = to; at !== from; ) {
          const step = arrived.get(at) as PathStep;

          steps.unshift(step);
          at = step.from;
        }

        return steps;
      }

      frontier = next;
    }

    return null;
  }

  private rowsFrom(pick: (edge: Dependency) => string | null): NeighbourRow[] {
    const known = new Set(this.modules);
    const members = Neighbours.membersOf(this.repository);
    const byId = new Map<string, Dependency[]>();

    for (const edge of this.repository.dependencies.filter(
      (edge) => edge.countsAsEdge,
    )) {
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

    return [...byId.entries()]
      .map(([id, edges]) => {
        const names = new Set<string>();
        let isPrivate = false;

        for (const edge of edges) {
          for (const name of Neighbours.edgeNames(edge)) {
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
}
