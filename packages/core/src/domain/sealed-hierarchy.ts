import type { Dependency } from "./dependency.js";
import type { Repository } from "./repository.js";

export function sealedGroups(
  repository: Repository,
  edges: readonly Dependency[],
): Map<string, string> {
  const sealed = new Map<string, Set<string>>();

  for (const file of repository.files) {
    for (const member of file.members) {
      if ((member.tags as string[] | undefined)?.includes("sealed")) {
        const names = sealed.get(file.path) ?? new Set<string>();

        names.add(member.name);
        sealed.set(file.path, names);
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
      edge.toMember !== undefined &&
      sealed.get(edge.to)?.has(edge.toMember)
    ) {
      union(edge.from, edge.to);
    }
  }

  const groups = new Map<string, string>();

  for (const file of repository.files) {
    groups.set(file.path, find(file.path));
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
