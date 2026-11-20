import type { OpenModules } from "./open-modules";

export type Selection = {
  kind: "module" | "folder" | "edge";
  id: string;
} | null;

export type Presence = {
  module: (id: string) => boolean;
  folder: (path: string) => boolean;
  edge: (id: string) => boolean;
};

export type CanvasState = {
  selection: () => Selection;
  select: (selection: Selection) => void;
  clearSelection: () => void;
  folded: () => ReadonlySet<string>;
  toggleFold: (folder: string) => void;
  focus: () => string | null;
  toggleFocus: (folder: string) => void;
  showInferred: () => boolean;
  setShowInferred: (show: boolean) => void;
  takeOff: (selection: Selection) => void;
  clear: () => void;
  restore: (folded: Iterable<string>, focus: string | null) => void;
  reconcile: (present: Presence) => void;
};

export function createCanvasState(modules: OpenModules): CanvasState {
  const folded = new Set<string>();
  let selection: Selection = null;
  let focus: string | null = null;
  let showInferred = true;

  return {
    selection: () => selection,
    select(next) {
      selection = next;
    },
    clearSelection() {
      selection = null;
    },
    folded: () => folded,
    toggleFold(folder) {
      if (!folded.delete(folder)) {
        folded.add(folder);
      }
    },
    focus: () => focus,
    toggleFocus(folder) {
      focus = focus === folder ? null : folder;
    },
    showInferred: () => showInferred,
    setShowInferred(show) {
      showInferred = show;
    },
    takeOff(target) {
      if (target === null || target.kind === "edge") {
        return;
      }

      if (target.kind === "module") {
        modules.close(target.id);
      } else {
        for (const id of modules.opened()) {
          if (id.startsWith(`${target.id}/`)) {
            modules.close(id);
          }
        }
      }

      selection = null;
    },
    clear() {
      for (const id of modules.opened()) {
        modules.close(id);
      }

      folded.clear();
      focus = null;
      selection = null;
    },
    restore(nextFolded, nextFocus) {
      folded.clear();

      for (const folder of nextFolded) {
        folded.add(folder);
      }

      focus = nextFocus;
    },
    reconcile(present) {
      if (selection === null) {
        return;
      }

      const here =
        selection.kind === "module"
          ? present.module(selection.id)
          : selection.kind === "folder"
            ? present.folder(selection.id)
            : present.edge(selection.id);

      if (!here) {
        selection = null;
      }
    },
  };
}
