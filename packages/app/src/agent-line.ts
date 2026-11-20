import type { Mark } from "./view-history";

export function agentLineOf(mark: Mark): string {
  return `${mark.by} ${mark.summary}`;
}

export function backLabel(mark: Mark | null): string {
  return mark === null ? "Back" : `Back - undo ${mark.by}: ${mark.summary}`;
}

export function forwardLabel(mark: Mark | null): string {
  return mark === null
    ? "Forward"
    : `Forward - redo ${mark.by}: ${mark.summary}`;
}
