import { InputError, type View, validateView } from "recognizer";

export type ParsedView =
  | { ok: true; view: View }
  | { ok: false; reason: string };

export function serialiseView(view: View): string {
  const moduleNotes = Object.entries(view.module_notes ?? {}).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const ordered = {
    schema_version: 2,
    description: view.description,
    commit: view.commit,
    ...(view.note === undefined
      ? {}
      : { note: { text: view.note.text, by: view.note.by } }),
    ...(moduleNotes.length === 0
      ? {}
      : {
          module_notes: Object.fromEntries(
            moduleNotes.map(([module, note]) => [
              module,
              { text: note.text, by: note.by },
            ]),
          ),
        }),
    steps: view.steps,
  };

  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function parseViewFile(text: string): ParsedView {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `not valid JSON: ${(error as Error).message}` };
  }

  try {
    return { ok: true, view: validateView(value) };
  } catch (error) {
    if (error instanceof InputError) {
      return { ok: false, reason: error.messages.join("; ") };
    }

    throw error;
  }
}
