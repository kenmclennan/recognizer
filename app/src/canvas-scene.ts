import {
  boxFigures,
  boxSubline,
  type CanvasGraph,
  type EdgeStyle,
  frameFigure,
} from "./canvas-graph";
import type { Layout, Point, Rect } from "./canvas-layout";
import { FRAME_TOP } from "./canvas-layout";
import type { Disc } from "./health";

export const ARROW_LENGTH = 6;
export const ARROW_HALF_WIDTH = 2.4;
export const HOLLOW_ARROW_LENGTH = 9;
export const HOLLOW_ARROW_HALF_WIDTH = 4.6;
export const BOUNDS_MARGIN = 0;
export const DRAW_ORDER = ["frames", "lines", "boxes"] as const;

export const DASH: Record<EdgeStyle, string | null> = {
  plain: null,
  hollow: null,
  private: "4 3",
  inferred: "1.5 3",
};

export type SceneFrame = {
  path: string;
  rect: Rect;
  label: string;
  figure: string;
  disc: Disc;
  labelRect: Rect;
};

export type SceneBox = {
  id: string;
  kind: "module" | "folder";
  rect: Rect;
  label: string;
  figures: string;
  subline: string;
  disc: Disc;
};

export type SceneLine = {
  id: string;
  points: Point[];
  style: EdgeStyle;
  dash: string | null;
  count: number;
  countAt: Point | null;
};

export type SceneArrow = { lineId: string; points: Point[]; hollow: boolean };

export type Scene = {
  drawOrder: typeof DRAW_ORDER;
  frames: SceneFrame[];
  lines: SceneLine[];
  arrows: SceneArrow[];
  boxes: SceneBox[];
  bounds: Rect;
};

export function arrowhead(points: Point[], hollow = false): Point[] {
  const end = points[points.length - 1] as Point;
  const before = points[points.length - 2] ?? end;
  const dx = end.x - before.x;
  const dy = end.y - before.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const reach = hollow ? HOLLOW_ARROW_LENGTH : ARROW_LENGTH;
  const half = hollow ? HOLLOW_ARROW_HALF_WIDTH : ARROW_HALF_WIDTH;
  const base = { x: end.x - ux * reach, y: end.y - uy * reach };

  return [
    end,
    { x: base.x - uy * half, y: base.y + ux * half },
    { x: base.x + uy * half, y: base.y - ux * half },
  ];
}

function boundsOf(rects: Rect[], points: Point[]): Rect {
  const xs = [
    ...rects.flatMap((r) => [r.x, r.x + r.width]),
    ...points.map((p) => p.x),
  ];
  const ys = [
    ...rects.flatMap((r) => [r.y, r.y + r.height]),
    ...points.map((p) => p.y),
  ];

  if (xs.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const x = Math.min(...xs);
  const y = Math.min(...ys);

  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function midpoint(points: Point[]): Point {
  const a = points[Math.floor((points.length - 1) / 2)] as Point;
  const b = points[Math.ceil((points.length - 1) / 2)] as Point;

  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function toScene(graph: CanvasGraph, layout: Layout): Scene {
  const frames: SceneFrame[] = [];

  for (const frame of graph.frames) {
    const rect = layout.frames.get(frame.path);

    if (rect) {
      frames.push({
        path: frame.path,
        rect,
        label: frame.label,
        figure: frameFigure(frame),
        disc: frame.disc,
        labelRect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: FRAME_TOP,
        },
      });
    }
  }

  const boxes: SceneBox[] = [];

  for (const box of graph.boxes) {
    const rect = layout.boxes.get(box.id);

    if (rect) {
      boxes.push({
        id: box.id,
        kind: box.kind,
        rect,
        label: box.label,
        figures: boxFigures(box),
        subline: boxSubline(box),
        disc: box.disc,
      });
    }
  }

  const lines: SceneLine[] = [];
  const arrows: SceneArrow[] = [];

  for (const line of graph.lines) {
    const points = layout.lines.get(line.id);

    if (!points || points.length < 2) {
      continue;
    }

    lines.push({
      id: line.id,
      points,
      style: line.style,
      dash: DASH[line.style],
      count: line.count,
      countAt: line.count > 1 ? midpoint(points) : null,
    });
    arrows.push({
      lineId: line.id,
      points: arrowhead(points, line.style === "hollow"),
      hollow: line.style === "hollow",
    });
  }

  return {
    drawOrder: DRAW_ORDER,
    frames,
    lines,
    arrows,
    boxes,
    bounds: boundsOf(
      [...frames.map((f) => f.rect), ...boxes.map((b) => b.rect)],
      lines.flatMap((l) => l.points),
    ),
  };
}
