import type { FindingRecord } from "recognizer";
import type { Selection } from "./canvas-state";

const identity = (id: string) => id;

export function keepsFocus(
  selection: Selection,
  record: FindingRecord,
  boxFor: (id: string) => string = identity,
): boolean {
  if (selection === null || selection.kind === "edge") {
    return false;
  }

  const ids = new Set(record.evidence.modules);

  for (const edge of record.evidence.edges ?? []) {
    ids.add(edge.from);
    ids.add(edge.to);
  }

  return [...ids].some((id) => boxFor(id) === selection.id);
}
