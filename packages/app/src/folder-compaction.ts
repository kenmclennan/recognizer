import { Folder } from "@recognizer/core";

export type Compaction = {
  folders: ReadonlySet<string>;
  canonical: (folder: string) => string;
  label: (folder: string) => string;
  parent: (folder: string) => string | null;
  ancestors: (id: string) => string[];
};

export function compactFolders(all: readonly Folder[]): Compaction {
  const holdsModule = new Set<string>();
  const subfolders = new Map<string, Set<string>>([["", new Set<string>()]]);

  for (const folder of all) {
    if (folder.holdsFile) {
      holdsModule.add(folder.path);
    }

    const above = folder.parent ?? "";
    const children = subfolders.get(above) ?? new Set<string>();

    children.add(folder.path);
    subfolders.set(above, children);

    if (!subfolders.has(folder.path)) {
      subfolders.set(folder.path, new Set<string>());
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

  const ancestors = (id: string) =>
    Folder.chainOf(id)
      .map((folder) => folder.path)
      .filter((path) => folders.has(path));

  const parent = (folder: string) => ancestors(folder).pop() ?? null;

  const label = (folder: string) => {
    const above = parent(folder);

    return above === null ? folder : folder.slice(above.length + 1);
  };

  return { folders, canonical, label, parent, ancestors };
}
