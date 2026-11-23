import type { Finding } from "@recognizer/core";
import type { Selection } from "./canvas-state";

const identity = (id: string) => id;

export function keepsFocus(
  selection: Selection,
  record: Finding,
  boxFor: (id: string) => string = identity,
): boolean {
  if (selection === null || selection.kind === "edge") {
    return false;
  }

  const ids = new Set(record.files);

  for (const edge of record.dependencies ?? []) {
    ids.add(edge.from);
    ids.add(edge.to);
  }

  return [...ids].some((id) => boxFor(id) === selection.id);
}
