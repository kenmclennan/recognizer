import { type NeighbourRow, usesOf } from "./neighbours.js";
import type { Scan } from "./scan.js";

export type PathStep = Omit<NeighbourRow, "id"> & { from: string; to: string };

export function shortestPath(
  scans: Scan[],
  modules: string[],
  from: string,
  to: string,
): PathStep[] | null {
  if (from === to) {
    return [];
  }

  const arrived = new Map<string, PathStep>();
  const seen = new Set([from]);
  let frontier = [from];

  while (frontier.length > 0) {
    const next: string[] = [];

    for (const id of frontier) {
      for (const row of usesOf(scans, modules, id)) {
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
