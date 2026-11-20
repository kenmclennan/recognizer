import type { Scan, ScanEdge } from "./scan.js";

export function sealedGroups(
  scan: Scan,
  edges: readonly ScanEdge[],
): Map<string, string> {
  const sealed = new Map<string, Set<string>>();

  for (const module of scan.modules) {
    for (const member of module.members ?? []) {
      if ((member.tags as string[] | undefined)?.includes("sealed")) {
        const names = sealed.get(module.id) ?? new Set<string>();

        names.add(member.name);
        sealed.set(module.id, names);
      }
    }
  }

  const parent = new Map<string, string>();

  const find = (id: string): string => {
    const up = parent.get(id);

    if (up === undefined || up === id) {
      return id;
    }

    const root = find(up);

    parent.set(id, root);

    return root;
  };

  const union = (a: string, b: string) => {
    const left = find(a);
    const right = find(b);

    if (left < right) {
      parent.set(right, left);
    } else if (right < left) {
      parent.set(left, right);
    }
  };

  for (const edge of edges) {
    if (edge.kind !== "inherits" && edge.kind !== "implements") {
      continue;
    }

    if (
      edge.to_member !== undefined &&
      sealed.get(edge.to)?.has(edge.to_member)
    ) {
      union(edge.from, edge.to);
    }
  }

  const groups = new Map<string, string>();

  for (const module of scan.modules) {
    groups.set(module.id, find(module.id));
  }

  for (const edge of edges) {
    for (const id of [edge.from, edge.to]) {
      if (!groups.has(id)) {
        groups.set(id, find(id));
      }
    }
  }

  return groups;
}
