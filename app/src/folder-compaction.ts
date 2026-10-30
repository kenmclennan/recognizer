export type Compaction = {
  folders: ReadonlySet<string>;
  canonical: (folder: string) => string;
  label: (folder: string) => string;
  parent: (folder: string) => string | null;
  ancestors: (id: string) => string[];
};

export function compactFolders(ids: Iterable<string>): Compaction {
  const holdsModule = new Set<string>();
  const subfolders = new Map<string, Set<string>>();

  for (const id of ids) {
    const parts = id.split("/");

    holdsModule.add(parts.slice(0, -1).join("/"));

    for (let depth = 1; depth < parts.length; depth += 1) {
      const parent = parts.slice(0, depth - 1).join("/");
      const path = parts.slice(0, depth).join("/");
      const children = subfolders.get(parent) ?? new Set<string>();

      children.add(path);
      subfolders.set(parent, children);

      if (!subfolders.has(path)) {
        subfolders.set(path, new Set<string>());
      }
    }
  }

  const passthrough = (folder: string) =>
    !holdsModule.has(folder) && (subfolders.get(folder)?.size ?? 0) === 1;

  const folders = new Set<string>();

  for (const folder of subfolders.keys()) {
    if (folder !== "" && !passthrough(folder)) {
      folders.add(folder);
    }
  }

  const canonical = (folder: string) => {
    let current = folder;

    while (current !== "" && subfolders.has(current) && passthrough(current)) {
      current = [...(subfolders.get(current) as Set<string>)][0] as string;
    }

    return current;
  };

  const ancestors = (id: string) => {
    const parts = id.split("/");

    return parts
      .slice(0, -1)
      .map((_, index) => parts.slice(0, index + 1).join("/"))
      .filter((path) => folders.has(path) && path !== id);
  };

  const parent = (folder: string) => ancestors(folder).pop() ?? null;

  const label = (folder: string) => {
    const above = parent(folder);

    return above === null ? folder : folder.slice(above.length + 1);
  };

  return { folders, canonical, label, parent, ancestors };
}
