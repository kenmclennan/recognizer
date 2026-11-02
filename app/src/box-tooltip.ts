import type { ResponsibilityState } from "./responsibility-model";

export const NOTE_PREVIEW = 60;

export type TooltipLine = { text: string; tone: "normal" | "dim" | "muted" };

function describe(state: ResponsibilityState): TooltipLine {
  if (state.kind === "current") {
    return { text: state.line, tone: "normal" };
  }

  if (state.kind === "out-of-date") {
    return { text: state.line, tone: "dim" };
  }

  return { text: "No description yet", tone: "muted" };
}

export function notePreview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();

  return flat.length > NOTE_PREVIEW
    ? `${flat.slice(0, NOTE_PREVIEW).trimEnd()}…`
    : flat;
}

export function boxTooltip(
  state: ResponsibilityState,
  note: string | null,
): TooltipLine[] {
  const lines = [describe(state)];

  if (note !== null && note.trim() !== "") {
    lines.push({ text: `Note: ${notePreview(note)}`, tone: "muted" });
  }

  return lines;
}
