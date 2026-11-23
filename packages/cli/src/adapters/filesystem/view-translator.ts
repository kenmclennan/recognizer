import { View, type ViewFields, type ViewRead } from "@recognizer/core";
import { InputError } from "../../errors.js";
import validate from "../../generated/view-validator.js";

export type ParsedViewText =
  | { ok: true; view: View; warnings: string[] }
  | { ok: false; reason: string };

export function validateView(value: unknown): View {
  if (validate(value)) {
    return View.of(value as unknown as ViewFields);
  }

  const messages = (validate.errors ?? []).map(
    (error) => `view${error.instancePath} ${error.message ?? "is invalid"}`,
  );

  throw new InputError(messages.length > 0 ? messages : ["view is invalid"]);
}

export function serialiseView(view: View | ViewFields): string {
  const entity = view instanceof View ? view : View.of(view);

  return `${JSON.stringify(entity.document(), null, 2)}\n`;
}

export function readViewText(text: string, name: string): ViewRead {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, messages: [`view ${name} is not valid JSON`] };
  }

  try {
    return { ok: true, view: validateView(parsed) };
  } catch (error) {
    if (error instanceof InputError) {
      return {
        ok: false,
        messages: [`view ${name} is invalid`, ...error.messages],
      };
    }

    throw error;
  }
}

export function parseViewFile(text: string): ParsedViewText {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `not valid JSON: ${(error as Error).message}` };
  }

  try {
    const view = validateView(value);

    return { ok: true, view, warnings: view.noteWarnings() };
  } catch (error) {
    if (error instanceof InputError) {
      return { ok: false, reason: error.messages.join("; ") };
    }

    throw error;
  }
}
