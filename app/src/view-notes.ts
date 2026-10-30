import { migrateView, type View, viewNotes } from "recognizer";

export const NOTE_AUTHOR_LIMIT = 64;

export function addNote(
  view: View,
  module: string,
  text: string,
  by: string,
): View {
  const trimmed = text.trim();
  const author = by.trim();

  if (trimmed === "" || author === "") {
    return view;
  }

  return {
    ...migrateView(view),
    notes: [...viewNotes(view), { module, text: trimmed, by: author }],
  };
}

export function removeNoteAt(view: View, index: number): View {
  const notes = viewNotes(view);
  const migrated = migrateView(view);

  if (index < 0 || index >= notes.length) {
    return migrated;
  }

  const kept = notes.filter((_, at) => at !== index);
  const { notes: _dropped, ...rest } = migrated;

  return kept.length === 0 ? rest : { ...rest, notes: kept };
}

export function notedModules(view: View): Set<string> {
  return new Set(viewNotes(view).map((note) => note.module));
}
