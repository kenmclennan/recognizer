import type { Selection } from "./canvas-state";

export type KeyInput = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  targetEditable: boolean;
};

export type KeyAction =
  | "focus"
  | "fold"
  | "take-off"
  | "escape"
  | "dependencies"
  | "contents"
  | "add-note"
  | "remove-note"
  | "next-note"
  | "previous-note"
  | "next-finding"
  | "previous-finding";

export type NoteKeyContext = {
  notesOpen: boolean;
  noteActive: boolean;
  findingsOpen: boolean;
};

const NO_NOTES: NoteKeyContext = {
  notesOpen: false,
  noteActive: false,
  findingsOpen: false,
};

export function keyAction(
  event: KeyInput,
  selection: Selection,
  notes: NoteKeyContext = NO_NOTES,
): KeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }

  if (event.targetEditable) {
    return null;
  }

  if (event.key === "Escape") {
    return "escape";
  }

  const key = event.key.toLowerCase();

  if (notes.notesOpen && key === "j") {
    return "next-note";
  }

  if (notes.notesOpen && key === "k") {
    return "previous-note";
  }

  if (notes.findingsOpen && key === "j") {
    return "next-finding";
  }

  if (notes.findingsOpen && key === "k") {
    return "previous-finding";
  }

  if (notes.notesOpen && notes.noteActive && event.key === "Backspace") {
    return "remove-note";
  }

  if (selection === null) {
    return null;
  }

  if (event.key === "Backspace") {
    return selection.kind === "edge" ? null : "take-off";
  }

  if (key === "n") {
    return selection.kind === "module" ? "add-note" : null;
  }

  if (selection.kind === "edge") {
    return null;
  }

  if (key === "d") {
    return "dependencies";
  }

  if (key === "i") {
    return "contents";
  }

  if (selection.kind !== "folder") {
    return null;
  }

  return key === "f" ? "focus" : key === "z" ? "fold" : null;
}

export function isEditable(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;

  if (!node || typeof node.tagName !== "string") {
    return false;
  }

  return (
    node.tagName === "INPUT" ||
    node.tagName === "TEXTAREA" ||
    node.isContentEditable === true
  );
}
