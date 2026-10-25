export type FileNode = { kind: "file"; name: string; path: string };

export type FolderNode = {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
};

export type TreeNode = FileNode | FolderNode;

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function sorted(folder: FolderNode): void {
  folder.children.sort((a, b) =>
    a.kind === b.kind
      ? byCodeUnit(a.name, b.name)
      : a.kind === "folder"
        ? -1
        : 1,
  );

  for (const child of folder.children) {
    if (child.kind === "folder") {
      sorted(child);
    }
  }
}

export function buildTree(ids: Iterable<string>): FolderNode {
  const root: FolderNode = { kind: "folder", name: "", path: "", children: [] };
  const folders = new Map<string, FolderNode>([["", root]]);

  for (const id of ids) {
    const parts = id.split("/");
    let parent = root;

    for (let depth = 1; depth < parts.length; depth += 1) {
      const path = parts.slice(0, depth).join("/");
      let folder = folders.get(path);

      if (!folder) {
        folder = {
          kind: "folder",
          name: parts[depth - 1] as string,
          path,
          children: [],
        };
        folders.set(path, folder);
        parent.children.push(folder);
      }

      parent = folder;
    }

    parent.children.push({
      kind: "file",
      name: parts[parts.length - 1] as string,
      path: id,
    });
  }

  sorted(root);

  return root;
}

export function filesOf(node: TreeNode): FileNode[] {
  return node.kind === "file" ? [node] : node.children.flatMap(filesOf);
}

export function ancestorFolders(id: string): string[] {
  const parts = id.split("/");

  return parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join("/"));
}
