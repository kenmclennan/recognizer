import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";

export const SHAPE = { boxes: 433, lines: 1805, frames: 30 };

export function lightcycleShapedGraph(): ElkNode {
  const root: ElkNode = {
    id: "root",
    children: [],
    edges: [],
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "24",
      "elk.layered.spacing.nodeNodeBetweenLayers": "44",
      "elk.padding": "[top=12,left=12,bottom=12,right=12]",
    },
  };
  const frames: ElkNode[] = [];

  for (let index = 0; index < SHAPE.frames; index += 1) {
    const frame: ElkNode = {
      id: `f:${index}`,
      children: [],
      layoutOptions: {
        "elk.padding": "[top=28,left=12,bottom=12,right=12]",
        "elk.nodeSize.constraints": "MINIMUM_SIZE",
        "elk.nodeSize.minimum": "(0, 120)",
      },
    };
    const parent = index < 4 ? root : frames[Math.floor((index - 4) / 3)];

    (parent.children as ElkNode[]).push(frame);
    frames.push(frame);
  }

  const boxes: string[] = [];

  for (let index = 0; index < SHAPE.boxes; index += 1) {
    const id = `m${index}`;

    (frames[index % SHAPE.frames].children as ElkNode[]).push({
      id,
      width: 96 + (index % 7) * 12,
      height: 40,
    });
    boxes.push(id);
  }

  const edges: ElkExtendedEdge[] = [];

  for (let index = 0; edges.length < SHAPE.lines; index += 1) {
    const from = (index * 37) % SHAPE.boxes;
    const to = Math.min(SHAPE.boxes - 1, from + 1 + ((index * 7) % 3));

    if (from !== to) {
      edges.push({
        id: `e${index}`,
        sources: [boxes[from]],
        targets: [boxes[to]],
      });
    }
  }

  root.edges = edges;

  return root;
}
