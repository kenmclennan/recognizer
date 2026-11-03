import type { Rect } from "./canvas-layout";
import type { Scene } from "./canvas-scene";

export const HEADING_GAP = 16;
export const HEADING_WIDTH = 720;
export const TITLE_SIZE = 20;
export const TITLE_LINE = 24;
export const TITLE_TO_DESCRIPTION = 4;
export const DESCRIPTION_SIZE = 14;
export const DESCRIPTION_LINE = 20.3;
export const DESCRIPTION_MAX_LINES = 3;

export type Heading = { title: string | null; description: string };

export type HeadingAnchor = { centre: number; top: number };

export type HeadingLayout = {
  titleLines: string[];
  descriptionLines: string[];
  rect: Rect;
  centre: number;
};

export function headingAnchor(
  scene: Pick<Scene, "frames" | "boxes">,
): HeadingAnchor | null {
  if (scene.boxes.length === 0) {
    return null;
  }

  const rects = [
    ...scene.frames.filter((frame) => frame.parent === null),
    ...scene.boxes.filter((box) => box.parent === null),
  ].map((item) => item.rect);

  if (rects.length === 0) {
    return null;
  }

  const left = Math.min(...rects.map((rect) => rect.x));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));

  return {
    centre: (left + right) / 2,
    top: Math.min(...rects.map((rect) => rect.y)),
  };
}

function splitWord(
  word: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const pieces: string[] = [];
  let current = "";

  for (const char of word) {
    if (current !== "" && measure(current + char) > width) {
      pieces.push(current);
      current = char;
    } else {
      current += char;
    }
  }

  if (current !== "") {
    pieces.push(current);
  }

  return pieces;
}

export function wrapLines(
  text: string,
  width: number,
  measure: (text: string) => number,
  maxLines: number | null,
): string[] {
  const lines: string[] = [];
  let current = "";

  for (const word of text.split(/\s+/).filter((w) => w !== "")) {
    const joined = current === "" ? word : `${current} ${word}`;

    if (measure(joined) <= width) {
      current = joined;

      continue;
    }

    if (current !== "") {
      lines.push(current);
      current = "";
    }

    if (measure(word) <= width) {
      current = word;
    } else {
      const pieces = splitWord(word, width, measure);

      lines.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1] ?? "";
    }
  }

  if (current !== "") {
    lines.push(current);
  }

  if (maxLines === null || lines.length <= maxLines) {
    return lines;
  }

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1] as string;

  while (last !== "" && measure(`${last}…`) > width) {
    last = last.slice(0, -1).trimEnd();
  }

  kept[maxLines - 1] = `${last}…`;

  return kept;
}

export function layoutHeading(
  heading: Heading,
  anchor: HeadingAnchor,
  measureTitle: (text: string) => number,
  measureDescription: (text: string) => number,
): HeadingLayout | null {
  const title = heading.title?.trim() ?? "";
  const titleLines =
    title === "" ? [] : wrapLines(title, HEADING_WIDTH, measureTitle, null);
  const descriptionLines = wrapLines(
    heading.description,
    HEADING_WIDTH,
    measureDescription,
    DESCRIPTION_MAX_LINES,
  );

  if (titleLines.length === 0 && descriptionLines.length === 0) {
    return null;
  }

  const height =
    titleLines.length * TITLE_LINE +
    (titleLines.length > 0 && descriptionLines.length > 0
      ? TITLE_TO_DESCRIPTION
      : 0) +
    descriptionLines.length * DESCRIPTION_LINE;

  return {
    titleLines,
    descriptionLines,
    centre: anchor.centre,
    rect: {
      x: anchor.centre - HEADING_WIDTH / 2,
      y: anchor.top - height - HEADING_GAP,
      width: HEADING_WIDTH,
      height,
    },
  };
}

export function withHeading(bounds: Rect, rect: Rect | null): Rect {
  if (rect === null) {
    return bounds;
  }

  const x = Math.min(bounds.x, rect.x);
  const y = Math.min(bounds.y, rect.y);

  return {
    x,
    y,
    width: Math.max(bounds.x + bounds.width, rect.x + rect.width) - x,
    height: Math.max(bounds.y + bounds.height, rect.y + rect.height) - y,
  };
}
