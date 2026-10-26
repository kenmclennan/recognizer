import type { Selection } from "./canvas-state";

export type KeyInput = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  targetEditable: boolean;
  pickerOpen: boolean;
};

export type KeyAction =
  | "focus"
  | "fold"
  | "take-off"
  | "escape"
  | "uses"
  | "used-by";

export function keyAction(
  event: KeyInput,
  selection: Selection,
): KeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }

  if (event.targetEditable) {
    return event.key === "Escape" && event.pickerOpen ? "escape" : null;
  }

  if (event.key === "Escape") {
    return "escape";
  }

  if (selection === null) {
    return null;
  }

  if (event.key === "Backspace") {
    return selection.kind === "edge" ? null : "take-off";
  }

  const key = event.key.toLowerCase();

  if (selection.kind === "edge") {
    return null;
  }

  if (key === "u") {
    return "uses";
  }

  if (key === "d") {
    return "used-by";
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
