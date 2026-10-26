import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import { boxFigures, type CanvasGraph, frameFigure } from "./canvas-graph";

export const BOX_HEIGHT = 36;
export const BOX_MIN_WIDTH = 96;
export const BOX_PAD = 10;
export const DISC_SIZE = 10;
export const LABEL_GAP = 6;
export const FRAME_TOP = 28;
export const FRAME_PAD = 12;
export const NODE_SPACING = 24;
export const LAYER_SPACING = 44;

export type Measure = (text: string) => number;
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export type Layout = {
  frames: Map<string, Rect>;
  boxes: Map<string, Rect>;
  lines: Map<string, Point[]>;
};

const FRAME_PREFIX = "f:";

export const frameNodeId = (path: string) => `${FRAME_PREFIX}${path}`;

export function boxWidth(
  measure: Measure,
  label: string,
  figures: string,
): number {
  const text =
    measure(label) +
    DISC_SIZE +
    LABEL_GAP +
    (figures === "" ? 0 : measure(figures) + LABEL_GAP);

  return Math.max(BOX_MIN_WIDTH, Math.ceil(text + BOX_PAD * 2));
}

export function frameLabelWidth(
  measure: Measure,
  label: string,
  figure: string,
): number {
  return Math.ceil(
    measure(label) +
      measure(figure) +
      DISC_SIZE +
      LABEL_GAP * 2 +
      FRAME_PAD * 2,
  );
}

export function toElk(graph: CanvasGraph, measure: Measure): ElkNode {
  const nodes = new Map<string, ElkNode>();

  for (const frame of graph.frames) {
    nodes.set(frame.path, {
      id: frameNodeId(frame.path),
      children: [],
      layoutOptions: {
        "elk.padding": `[top=${FRAME_TOP},left=${FRAME_PAD},bottom=${FRAME_PAD},right=${FRAME_PAD}]`,
        "elk.nodeSize.constraints": "MINIMUM_SIZE",
        "elk.nodeSize.minimum": `(0, ${frameLabelWidth(measure, frame.label, frameFigure(frame))})`,
      },
    });
  }

  const root: ElkNode = {
    id: "root",
    children: [],
    edges: [],
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": String(NODE_SPACING),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(LAYER_SPACING),
      "elk.padding": `[top=${FRAME_PAD},left=${FRAME_PAD},bottom=${FRAME_PAD},right=${FRAME_PAD}]`,
    },
  };

  const holder = (parent: string | null): ElkNode[] =>
    ((parent === null ? root : nodes.get(parent)) as ElkNode)
      .children as ElkNode[];

  for (const frame of graph.frames) {
    const node = nodes.get(frame.path) as ElkNode;
    holder(frame.parent).push(node);
  }

  for (const box of graph.boxes) {
    holder(box.parent).push({
      id: box.id,
      width: boxWidth(measure, box.label, boxFigures(box)),
      height: BOX_HEIGHT,
    });
  }

  root.edges = graph.lines.map(
    (line): ElkExtendedEdge => ({
      id: line.id,
      sources: [line.from],
      targets: [line.to],
    }),
  );

  return root;
}

export function absoluteLayout(result: ElkNode): Layout {
  const layout: Layout = {
    frames: new Map(),
    boxes: new Map(),
    lines: new Map(),
  };
  const origins = new Map<string, Point>();
  const edges: { edge: ElkExtendedEdge; holder: string }[] = [];

  function walk(node: ElkNode, origin: Point) {
    origins.set(node.id, origin);

    for (const edge of node.edges ?? []) {
      edges.push({ edge: edge as ElkExtendedEdge, holder: node.id });
    }

    for (const child of node.children ?? []) {
      const at = { x: origin.x + (child.x ?? 0), y: origin.y + (child.y ?? 0) };
      const rect = {
        x: at.x,
        y: at.y,
        width: child.width ?? 0,
        height: child.height ?? 0,
      };

      if (child.id.startsWith(FRAME_PREFIX)) {
        layout.frames.set(child.id.slice(FRAME_PREFIX.length), rect);
      } else {
        layout.boxes.set(child.id, rect);
      }

      walk(child, at);
    }
  }

  walk(result, { x: 0, y: 0 });

  for (const { edge, holder } of edges) {
    const base = origins.get(edge.container ?? holder) ?? { x: 0, y: 0 };
    const section = edge.sections?.[0];

    if (!section) {
      continue;
    }

    layout.lines.set(
      edge.id,
      [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(
        (point) => ({ x: base.x + point.x, y: base.y + point.y }),
      ),
    );
  }

  return layout;
}
