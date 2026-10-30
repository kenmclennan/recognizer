import type { Note, View } from "recognizer";

export const NOTE_AUTHOR_LIMIT = 64;

function withVersion(view: View): View {
  return { ...view, schema_version: 2 };
}

function noteOf(text: string, by: string): Note | null {
  const trimmed = text.trim();
  const author = by.trim();

  return trimmed === "" || author === "" ? null : { text: trimmed, by: author };
}

function withModuleNotes(view: View, notes: Record<string, Note>): View {
  const { module_notes: _dropped, ...rest } = withVersion(view);

  return Object.keys(notes).length === 0
    ? rest
    : { ...rest, module_notes: notes };
}

export function setViewNote(view: View, text: string, by: string): View {
  const note = noteOf(text, by);

  return note === null ? view : { ...withVersion(view), note };
}

export function removeViewNote(view: View): View {
  const { note: _dropped, ...rest } = withVersion(view);

  return rest;
}

export function setModuleNote(
  view: View,
  module: string,
  text: string,
  by: string,
): View {
  const note = noteOf(text, by);

  return note === null
    ? view
    : withModuleNotes(view, { ...view.module_notes, [module]: note });
}

export function removeModuleNote(view: View, module: string): View {
  const { [module]: _dropped, ...rest } = view.module_notes ?? {};

  return withModuleNotes(view, rest);
}

export function notedModules(view: View): Set<string> {
  return new Set(Object.keys(view.module_notes ?? {}));
}
