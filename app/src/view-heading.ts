import type { Rect } from "./canvas-layout";
import type { Scene } from "./canvas-scene";

export const DESCRIPTION_MAX_LINES = 3;

export type HeadingMetrics = {
  titleSize: number;
  titleLine: number;
  descriptionSize: number;
  descriptionLine: number;
  titleToDescription: number;
  gap: number;
  wrapWidth: number;
};

export function headingMetrics(width: number): HeadingMetrics {
  const titleSize = Math.min(64, Math.max(17, width * 0.022));
  const descriptionSize = Math.max(12, titleSize * 0.62);

  return {
    titleSize,
    titleLine: titleSize * 1.2,
    descriptionSize,
    descriptionLine: descriptionSize * 1.45,
    titleToDescription: titleSize * 0.25,
    gap: Math.max(16, titleSize * 0.8),
    wrapWidth: Math.max(720, width * 0.8),
  };
}

export type Heading = {
  title: string | null;
  description: string;
  facts?: readonly string[];
};

export type HeadingAnchor = { centre: number; top: number; width: number };

export type HeadingLayout = {
  titleLines: string[];
  descriptionLines: string[];
  rect: Rect;
  centre: number;
  metrics: HeadingMetrics;
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
    width: right - left,
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

  return endWithEllipsis(lines.slice(0, maxLines), width, measure);
}

function endWithEllipsis(
  kept: string[],
  width: number,
  measure: (text: string) => number,
): string[] {
  const end = kept.length - 1;
  let last = kept[end] as string;

  while (last !== "" && measure(`${last}…`) > width) {
    last = last.slice(0, -1).trimEnd();
  }

  kept[end] = `${last}…`;

  return kept;
}

const FACTS_MAX_LINES = 3;
const PARAGRAPH_WITH_FACTS_MAX_LINES = 2;

function descriptionWithFacts(
  heading: Heading,
  width: number,
  measure: (text: string) => number,
): string[] {
  if (heading.facts === undefined) {
    return wrapLines(
      heading.description,
      width,
      measure,
      DESCRIPTION_MAX_LINES,
    );
  }

  const facts = heading.facts.flatMap((entry) =>
    wrapLines(entry, width, measure, null),
  );

  if (facts.length > FACTS_MAX_LINES) {
    return endWithEllipsis(facts.slice(0, FACTS_MAX_LINES), width, measure);
  }

  const room = Math.max(
    0,
    Math.min(PARAGRAPH_WITH_FACTS_MAX_LINES, FACTS_MAX_LINES - facts.length),
  );
  const paragraph =
    room === 0 ? [] : wrapLines(heading.description, width, measure, room);

  return [...paragraph, ...facts];
}

export function layoutHeading(
  heading: Heading,
  anchor: HeadingAnchor,
  measureTitle: (size: number) => (text: string) => number,
  measureDescription: (size: number) => (text: string) => number,
): HeadingLayout | null {
  const metrics = headingMetrics(anchor.width);
  const title = heading.title?.trim() ?? "";
  const titleLines =
    title === ""
      ? []
      : wrapLines(
          title,
          metrics.wrapWidth,
          measureTitle(metrics.titleSize),
          null,
        );
  const descriptionLines = descriptionWithFacts(
    heading,
    metrics.wrapWidth,
    measureDescription(metrics.descriptionSize),
  );

  if (titleLines.length === 0 && descriptionLines.length === 0) {
    return null;
  }

  const height =
    titleLines.length * metrics.titleLine +
    (titleLines.length > 0 && descriptionLines.length > 0
      ? metrics.titleToDescription
      : 0) +
    descriptionLines.length * metrics.descriptionLine;

  return {
    titleLines,
    descriptionLines,
    centre: anchor.centre,
    metrics,
    rect: {
      x: anchor.centre - metrics.wrapWidth / 2,
      y: anchor.top - height - metrics.gap,
      width: metrics.wrapWidth,
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
