import { type View, type ViewNote, viewNotes } from "recognizer";
import type { Selection } from "./canvas-state";
import {
  CARD_LINE,
  CARD_PADDING,
  CARD_WRAP,
  type IndexedNote,
  tint,
  wrap,
} from "./notes-order";

export type NoteFocus = { module: string; active: number | null };

export type NoteRow = {
  index: number;
  module: string;
  text: string;
  by: string;
  tint: "person" | "agent";
  off: boolean;
  active: boolean;
};

export const COMPOSER_HEIGHT = 96;

export function keepsFocus(
  selection: Selection,
  focus: { module: string },
): boolean {
  return selection?.kind === "module" && selection.id === focus.module;
}

export function cardNotes(view: View, module: string): IndexedNote[] {
  return viewNotes(view).flatMap((note: ViewNote, index) =>
    note.module === module ? [{ index, note }] : [],
  );
}

export function firstNote(view: View, module: string): number | null {
  return cardNotes(view, module)[0]?.index ?? null;
}

export function noteRow(
  entry: IndexedNote,
  author: string,
  active: number | null,
  off: boolean,
): NoteRow {
  return {
    index: entry.index,
    module: entry.note.module,
    text: entry.note.text,
    by: entry.note.by,
    tint: tint(entry.note.by, author),
    off,
    active: entry.index === active,
  };
}

export function cardHeight(entries: readonly IndexedNote[]): number {
  const notes = entries.reduce(
    (sum, entry) =>
      sum +
      (wrap(entry.note.text.trim(), CARD_WRAP).length + 1) * CARD_LINE +
      CARD_PADDING,
    0,
  );

  return notes + COMPOSER_HEIGHT;
}
