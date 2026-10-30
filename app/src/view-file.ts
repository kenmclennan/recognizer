import { InputError, migrateView, type View, validateView } from "recognizer";

export type ParsedView =
  | { ok: true; view: View }
  | { ok: false; reason: string };

export function serialiseView(view: View): string {
  const migrated = migrateView(view);
  const ordered = {
    schema_version: 3,
    description: migrated.description,
    commit: migrated.commit,
    ...(migrated.notes === undefined
      ? {}
      : {
          notes: migrated.notes.map((note) => ({
            module: note.module,
            text: note.text,
            by: note.by,
          })),
        }),
    steps: migrated.steps,
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
