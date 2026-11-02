import { migrateView, type View, type ViewNote, viewNotes } from "recognizer";

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
  const replaced = notes.some((note) => note.module === path);

  return {
    ...migrateView(view),
    notes: replaced
      ? notes.map((note) => (note.module === path ? entry : note))
      : [...notes, entry],
  };
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
