import { type Compaction, compactFolders } from "./folder-compaction";

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

export function buildTree(
  ids: readonly string[],
  compaction: Compaction = compactFolders(ids),
): FolderNode {
  const root: FolderNode = { kind: "folder", name: "", path: "", children: [] };
  const folders = new Map<string, FolderNode>([["", root]]);

  for (const id of ids) {
    let parent = root;

    for (const path of compaction.ancestors(id)) {
      let folder = folders.get(path);

      if (!folder) {
        folder = {
          kind: "folder",
          name: compaction.label(path),
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
      name: id.slice(id.lastIndexOf("/") + 1),
      path: id,
    });
  }

  sorted(root);

  return root;
}

export function filesOf(node: TreeNode): FileNode[] {
  return node.kind === "file" ? [node] : node.children.flatMap(filesOf);
}
