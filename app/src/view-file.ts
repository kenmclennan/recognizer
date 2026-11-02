import {
  InputError,
  noteWarnings,
  serialiseView,
  type View,
  validateView,
} from "recognizer";

export { serialiseView };

export type ParsedView =
  | { ok: true; view: View; warnings: string[] }
  | { ok: false; reason: string };

export function parseViewFile(text: string): ParsedView {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `not valid JSON: ${(error as Error).message}` };
  }

  try {
    const view = validateView(value);

    return { ok: true, view, warnings: noteWarnings(view) };
  } catch (error) {
    if (error instanceof InputError) {
      return { ok: false, reason: error.messages.join("; ") };
    }

    throw error;
  }
}
