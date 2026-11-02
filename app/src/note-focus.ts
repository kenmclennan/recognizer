import { type View, viewNotes } from "recognizer";
import type { Rect } from "./canvas-layout";
import type { Selection } from "./canvas-state";

export type NoteFocus = { path: string; editing: boolean };

export type NoteRow = {
  path: string;
  kind: "module" | "folder";
  text: string;
  by: string;
  off: boolean;
  active: boolean;
};

export type BubblePlace = {
  left: number;
  top: number;
  side: "right" | "left";
  tailY: number;
};

export const BUBBLE_GAP = 10;
export const BUBBLE_EDGE = 12;
export const TAIL_INSET = 14;

export function notePathOf(selection: Selection): string | null {
  if (selection?.kind === "module") {
    return selection.id;
  }

  if (selection?.kind === "folder") {
    return `${selection.id}/`;
  }

  return null;
}

export function keepsFocus(
  selection: Selection,
  focus: { path: string },
): boolean {
  return notePathOf(selection) === focus.path;
}

export function noteKind(path: string): "module" | "folder" {
  return path.endsWith("/") ? "folder" : "module";
}

function byPath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function noteRows(
  view: View,
  positions: ReadonlyMap<string, Rect>,
  active: string | null,
): NoteRow[] {
  const rows = viewNotes(view).map((note) => ({
    path: note.module,
    kind: noteKind(note.module),
    text: note.text,
    by: note.by,
    off: !positions.has(note.module),
    active: note.module === active,
  }));
  const on = rows
    .filter((row) => !row.off)
    .sort((a, b) => {
      const left = positions.get(a.path) as Rect;
      const right = positions.get(b.path) as Rect;

      return left.y - right.y || left.x - right.x || byPath(a.path, b.path);
    });
  const off = rows
    .filter((row) => row.off)
    .sort((a, b) => byPath(a.path, b.path));

  return [...on, ...off];
}

export function walkNotes(
  rows: readonly NoteRow[],
  active: string | null,
  delta: 1 | -1,
): string | null {
  const sequence = rows.filter((row) => !row.off).map((row) => row.path);

  if (sequence.length === 0) {
    return active;
  }

  const at = active === null ? -1 : sequence.indexOf(active);

  if (at === -1) {
    return delta === 1 ? (sequence[0] as string) : (sequence.at(-1) as string);
  }

  const next = Math.min(sequence.length - 1, Math.max(0, at + delta));

  return sequence[next] as string;
}

export function bubblePlace(
  target: Rect,
  mark: Rect,
  size: { width: number; height: number },
  view?: Rect,
): BubblePlace {
  const rightLeft = target.x + target.width + BUBBLE_GAP;
  const right =
    view === undefined ||
    rightLeft + size.width + BUBBLE_EDGE <= view.x + view.width;
  const left = right ? rightLeft : target.x - BUBBLE_GAP - size.width;
  let top = target.y;

  if (view !== undefined) {
    const max = view.y + view.height - size.height - BUBBLE_EDGE;

    top = Math.max(view.y + BUBBLE_EDGE, Math.min(top, max));
  }

  const tailY = Math.max(
    TAIL_INSET,
    Math.min(mark.y + mark.height / 2 - top, size.height - TAIL_INSET),
  );

  return { left, top, side: right ? "right" : "left", tailY };
}

export function bubbleSize(
  text: string,
  editing: boolean,
): {
  width: number;
  height: number;
} {
  const lines = Math.max(1, Math.ceil(text.trim().length / 30));

  return {
    width: 240,
    height: editing ? 150 : 60 + lines * 18,
  };
}
