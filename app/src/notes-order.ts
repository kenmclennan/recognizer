import type { ViewNote } from "recognizer";
import type { Rect } from "./canvas-layout";

export type IndexedNote = { index: number; note: ViewNote };

export type NoteGroup = { module: string; entries: IndexedNote[] };

export type NoteOrder = { groups: NoteGroup[]; off: IndexedNote[] };

export type CardLayout = { lines: string[]; card: Rect; leader: string };

export const CARD_WIDTH = 220;
export const CARD_GAP = 36;
export const CARD_LINE = 18;
export const CARD_PADDING = 16;
export const CARD_WRAP = 28;

export function orderNotes(
  notes: readonly ViewNote[],
  positions: ReadonlyMap<string, Rect>,
): NoteOrder {
  const byModule = new Map<string, IndexedNote[]>();
  const off: IndexedNote[] = [];

  notes.forEach((note, index) => {
    if (!positions.has(note.module)) {
      off.push({ index, note });

      return;
    }

    const entries = byModule.get(note.module) ?? [];

    entries.push({ index, note });
    byModule.set(note.module, entries);
  });

  const groups = [...byModule.entries()]
    .map(([module, entries]) => ({ module, entries }))
    .sort((a, b) => {
      const left = positions.get(a.module) as Rect;
      const right = positions.get(b.module) as Rect;

      return (
        left.y - right.y ||
        left.x - right.x ||
        (a.module < b.module ? -1 : a.module > b.module ? 1 : 0)
      );
    });

  return { groups, off };
}

export function walk(
  order: NoteOrder,
  active: number | null,
  delta: 1 | -1,
): number | null {
  const sequence = order.groups.flatMap((group) =>
    group.entries.map((entry) => entry.index),
  );

  if (sequence.length === 0) {
    return active;
  }

  const at = active === null ? -1 : sequence.indexOf(active);

  if (at === -1) {
    return delta === 1 ? (sequence[0] as number) : (sequence.at(-1) as number);
  }

  const next = Math.min(sequence.length - 1, Math.max(0, at + delta));

  return sequence[next] as number;
}

export function tint(by: string, author: string): "person" | "agent" {
  return by === author ? "person" : "agent";
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    let line = "";

    for (const word of paragraph.split(/\s+/).filter((w) => w !== "")) {
      let rest = word;

      while (rest.length > width) {
        if (line !== "") {
          lines.push(line);
          line = "";
        }

        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }

      if (line === "") {
        line = rest;
      } else if (line.length + 1 + rest.length <= width) {
        line = `${line} ${rest}`;
      } else {
        lines.push(line);
        line = rest;
      }
    }

    lines.push(line);
  }

  return lines;
}

export function cardLayout(rect: Rect, text: string): CardLayout {
  const lines = wrap(text.trim(), CARD_WRAP);
  const card: Rect = {
    x: rect.x + rect.width + CARD_GAP,
    y: rect.y,
    width: CARD_WIDTH,
    height: lines.length * CARD_LINE + CARD_PADDING,
  };
  const startX = rect.x + rect.width;
  const startY = rect.y + rect.height / 2;
  const endY = card.y + card.height / 2;
  const reach = (card.x - startX) / 2;

  return {
    lines,
    card,
    leader: `M ${startX} ${startY} C ${startX + reach} ${startY}, ${card.x - reach} ${endY}, ${card.x} ${endY}`,
  };
}
