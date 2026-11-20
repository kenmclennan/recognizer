import type { Disc } from "./health";
import {
  type FileNode,
  type FolderNode,
  filesOf,
  type TreeNode,
} from "./tree-model";

export type FilterState = {
  text: string;
  onCanvas: boolean;
  needsAttention: boolean;
};

export type FilterContext = {
  isOpen: (id: string) => boolean;
  disc: (id: string) => Disc;
};

export type Filtered = {
  root: FolderNode;
  active: boolean;
  fileCount: number;
};

export function isActive(state: FilterState): boolean {
  return state.text !== "" || state.onCanvas || state.needsAttention;
}

function matches(
  file: FileNode,
  state: FilterState,
  context: FilterContext,
): boolean {
  if (
    state.text !== "" &&
    !file.path.toLowerCase().includes(state.text.toLowerCase())
  ) {
    return false;
  }

  if (state.onCanvas && !context.isOpen(file.path)) {
    return false;
  }

  if (state.needsAttention) {
    const disc = context.disc(file.path);

    return disc === "red" || disc === "amber";
  }

  return true;
}

function prune(
  folder: FolderNode,
  state: FilterState,
  context: FilterContext,
): FolderNode {
  const children = folder.children.flatMap((child): TreeNode[] => {
    if (child.kind === "file") {
      return matches(child, state, context) ? [child] : [];
    }

    const kept = prune(child, state, context);

    return kept.children.length > 0 ? [kept] : [];
  });

  return { ...folder, children };
}

export function filterTree(
  root: FolderNode,
  state: FilterState,
  context: FilterContext,
): Filtered {
  const active = isActive(state);
  const kept = active ? prune(root, state, context) : root;

  return { root: kept, active, fileCount: filesOf(kept).length };
}

export function isVisible(filtered: Filtered, id: string): boolean {
  return filesOf(filtered.root).some((file) => file.path === id);
}
