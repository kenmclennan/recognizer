import {
  appendNote,
  migrateView,
  moveNote,
  type View,
  type ViewNote,
  viewNotes,
} from "recognizer";
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

  const notes = viewNotes(view);
  const entry: ViewNote = { module: path, text: trimmed, by: author };

  return { ...migrateView(view), notes: appendNote(notes, entry) };
}

export function orderOf(view: View): OrderState {
  return {
    paths: viewNotes(view).map((note) => note.module),
  };
}

export function withOrder(view: View, state: OrderState): View {
  const notes = viewNotes(view);
  const named = state.paths.flatMap((path) => {
    const held = notes.find((note) => note.module === path);

    return held === undefined ? [] : [held];
  });
  const rest = notes.filter((note) => !state.paths.includes(note.module));
  const migrated = migrateView(view);
  const all = [...named, ...rest];

  if (all.length === 0) {
    const { notes: _notes, ...bare } = migrated;

    return bare;
  }

  return { ...migrated, notes: all };
}

export function withNoteMoved(view: View, path: string, toIndex: number): View {
  const moved = moveNote(viewNotes(view), path, toIndex).map(
    (note) => note.module,
  );

  return withOrder(view, { paths: moved });
}

export function removeNote(view: View, path: string): View {
  const notes = viewNotes(view);
  const migrated = migrateView(view);
  const kept = notes.filter((note) => note.module !== path);

  if (kept.length === notes.length) {
    return migrated;
  }

  const { notes: _dropped, ...rest } = migrated;

  return kept.length === 0 ? rest : { ...rest, notes: kept };
}

export function noteAt(view: View, path: string): ViewNote | null {
  return viewNotes(view).find((note) => note.module === path) ?? null;
}

export function notedPaths(view: View): Set<string> {
  return new Set(viewNotes(view).map((note) => note.module));
}
