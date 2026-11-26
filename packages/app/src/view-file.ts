import { View, type ViewFields } from "@recognizer/core";
import type { ParsedView } from "./visualisation-port";

function isFields(value: unknown): value is ViewFields {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    [1, 2, 3, 4].includes(record.schema_version as number) &&
    typeof record.description === "string" &&
    (record.commit === null || typeof record.commit === "string") &&
    Array.isArray(record.steps)
  );
}

export function parseViewFile(text: string): ParsedView {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `not valid JSON: ${(error as Error).message}` };
  }

  if (!isFields(value)) {
    return { ok: false, reason: "view is invalid" };
  }

  if (value.description.trim() === "") {
    return { ok: false, reason: "description must not be blank" };
  }

  const view = View.of(value);

  return { ok: true, view, warnings: view.noteWarnings() };
}

export function serialiseView(view: ViewFields): string {
  return `${JSON.stringify(View.of(view).document(), null, 2)}\n`;
}
