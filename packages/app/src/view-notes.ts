import { type View, type ViewNote, ViewNotes } from "@recognizer/core";
import type { OrderState } from "./view-history";

export const NOTE_AUTHOR_LIMIT = 64;

export function setNote(
  view: View,
  path: string,
  text: string,
  by: string,
): View {
  const trimmed = text.trim();
  const author = by.trim();

  if (trimmed === "" || author === "") {
    return view;
  }

  const notes = view.noteList();
  const entry: ViewNote = { module: path, text: trimmed, by: author };

  return view.migrated().with({ notes: ViewNotes.appendNote(notes, entry) });
}

export function orderOf(view: View): OrderState {
  return {
    paths: view.noteList().map((note) => note.module),
  };
}

export function withOrder(view: View, state: OrderState): View {
  const notes = view.noteList();
  const named = state.paths.flatMap((path) => {
    const held = notes.find((note) => note.module === path);

    return held === undefined ? [] : [held];
  });
  const rest = notes.filter((note) => !state.paths.includes(note.module));
  const migrated = view.migrated();
  const all = [...named, ...rest];

  return migrated.with({ notes: all.length === 0 ? undefined : all });
}

export function withNoteMoved(view: View, path: string, toIndex: number): View {
  const moved = ViewNotes.moveNote(view.noteList(), path, toIndex).map(
    (note) => note.module,
  );

  return withOrder(view, { paths: moved });
}

export function removeNote(view: View, path: string): View {
  const notes = view.noteList();
  const migrated = view.migrated();
  const kept = notes.filter((note) => note.module !== path);

  if (kept.length === notes.length) {
    return migrated;
  }

  return migrated.with({ notes: kept.length === 0 ? undefined : kept });
}

export function noteAt(view: View, path: string): ViewNote | null {
  return view.noteList().find((note) => note.module === path) ?? null;
}

export function notedPaths(view: View): Set<string> {
  return new Set(view.noteList().map((note) => note.module));
}
