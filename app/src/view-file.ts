import { InputError, type View, validateView } from "recognizer";

export type ParsedView =
  | { ok: true; view: View }
  | { ok: false; reason: string };

export function serialiseView(view: View): string {
  const ordered = {
    schema_version: view.schema_version,
    description: view.description,
    commit: view.commit,
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
