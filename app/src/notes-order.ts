import type { ViewNote } from "recognizer";
import type { Rect } from "./canvas-layout";

export type IndexedNote = { index: number; note: ViewNote };

export type NoteGroup = { module: string; entries: IndexedNote[] };

export type NoteOrder = { groups: NoteGroup[]; off: IndexedNote[] };

export type CardLayout = {
  lines: string[];
  card: Rect;
  leader: string;
  side: "right" | "left";
  pan: { x: number; y: number };
};

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

export const FINDING_CARD_WIDTH = 420;
export const FINDING_CARD_WRAP = 56;

const SOFT_BREAKS = ["/", "-.>:,"];

function softSplit(word: string, width: number): number {
  for (const breaks of SOFT_BREAKS) {
    for (let at = width; at > 0; at -= 1) {
      if (breaks.includes(word[at - 1] as string)) {
        return at;
      }
    }
  }

  return width;
}

function wrap(text: string, width: number, soft = false): string[] {
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

        const cut = soft ? softSplit(rest, width) : width;

        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
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

export const CARD_EDGE = 16;

export function cardLayout(
  rect: Rect,
  text: string,
  size: { width: number; wrap: number; soft: boolean } = {
    width: CARD_WIDTH,
    wrap: CARD_WRAP,
    soft: false,
  },
  view?: Rect,
  extra = 0,
): CardLayout {
  const lines = wrap(text.trim(), size.wrap, size.soft);
  const height = lines.length * CARD_LINE + CARD_PADDING;
  const rightX = rect.x + rect.width + CARD_GAP;
  const leftX = rect.x - CARD_GAP - size.width;
  const fitsRight =
    view === undefined || rightX + size.width <= view.x + view.width;
  const fitsLeft = view !== undefined && leftX >= view.x;
  const side = fitsRight || !fitsLeft ? "right" : "left";
  const card: Rect = {
    x: side === "right" ? rightX : leftX,
    y: rect.y,
    width: size.width,
    height,
  };
  const pan = { x: 0, y: 0 };

  if (view !== undefined && !fitsRight && !fitsLeft) {
    const left = rect.x;
    const right = card.x + card.width;
    const centre = (left + right) / 2 - (view.x + view.width / 2);

    pan.x = Math.min(centre, left - CARD_EDGE - view.x);
  }

  if (view !== undefined) {
    const over = card.y + height + extra + CARD_EDGE - (view.y + view.height);

    pan.y = Math.min(
      Math.max(over, 0),
      Math.max(rect.y - CARD_EDGE - view.y, 0),
    );
  }

  const startX = side === "right" ? rect.x + rect.width : rect.x;
  const startY = rect.y + rect.height / 2;
  const endX = side === "right" ? card.x : card.x + card.width;
  const endY = card.y + height / 2;
  const reach = (endX - startX) / 2;

  return {
    lines,
    card,
    side,
    pan,
    leader: `M ${startX} ${startY} C ${startX + reach} ${startY}, ${endX - reach} ${endY}, ${endX} ${endY}`,
  };
}
