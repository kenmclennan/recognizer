import {
  folderChain,
  folderCounts,
  lastSegment,
  moduleCounts,
  moduleLabel,
  neighbourSets,
  type Scan,
  type ScanEdge,
  under,
} from "recognizer";
import type { Selection } from "./canvas-state";
import type { Disc } from "./health";

export type EdgeStyle = "plain" | "private" | "inferred" | "hollow";

export type Frame = {
  path: string;
  label: string;
  parent: string | null;
  disc: Disc;
  open: number;
  held: number;
};

export type Box = {
  id: string;
  kind: "module" | "folder";
  label: string;
  parent: string | null;
  disc: Disc;
  open: number;
  held: number;
  missingUses: number;
  missingUsedBy: number;
};

export type Line = {
  id: string;
  from: string;
  to: string;
  style: EdgeStyle;
  count: number;
  edges: ScanEdge[];
};

export type Counts = { uses: number; usedBy: number };

export type CanvasGraph = {
  frames: Frame[];
  boxes: Box[];
  lines: Line[];
  counts: (selection: NonNullable<Selection>) => Counts;
  held: (folder: string) => number;
  openIn: (folder: string) => number;
};

export type GraphInput = {
  scans: Scan[];
  modules: string[];
  opened: string[];
  disc: (path: string) => Disc;
  folded: ReadonlySet<string>;
  focus: string | null;
  showInferred: boolean;
};

export { folderChain, lastSegment, moduleLabel, under };

export function lineId(
  from: string,
  to: string,
  style: EdgeStyle,
  edges: ScanEdge[],
): string {
  return `${from}>${to}:${style}:${edges.map((edge) => edge.line).join(",")}`;
}

function styleOf(
  edge: ScanEdge,
  members: Map<string, Map<string, boolean>>,
): EdgeStyle {
  if (edge.inferred) {
    return "inferred";
  }

  if (edge.kind !== "depends") {
    return "hollow";
  }

  const known = members.get(edge.to);

  if (known && edge.names?.some((name) => known.get(name) === false)) {
    return "private";
  }

  return "plain";
}

export function buildCanvasGraph(input: GraphInput): CanvasGraph {
  const known = new Set(input.modules);
  const allEdges = input.scans.flatMap((scan) => scan.edges);
  const members = new Map<string, Map<string, boolean>>();

  for (const scan of input.scans) {
    for (const module of scan.modules) {
      if (module.members) {
        members.set(
          module.id,
          new Map(module.members.map((m) => [m.name, m.exported])),
        );
      }
    }
  }

  const { focus } = input;
  const visible = new Set(
    input.opened.filter(
      (id) => known.has(id) && (focus === null || under(id, focus)),
    ),
  );
  const folds = [...input.folded].filter(
    (path) => focus === null || under(path, focus),
  );
  const foldOf = (id: string) =>
    folds
      .filter((path) => under(id, path))
      .sort((a, b) => a.length - b.length)[0] ?? null;
  const boxOf = (id: string) => foldOf(id) ?? id;

  const inFocus = (path: string) => focus === null || under(path, focus);
  const chainOf = (box: string) => folderChain(box).filter(inFocus);

  const openIn = (folder: string) =>
    input.opened.filter((id) => known.has(id) && under(id, folder)).length;
  const held = (folder: string) =>
    input.modules.filter((id) => under(id, folder)).length;

  const sets = neighbourSets(allEdges, known);
  const { uses, usedBy } = sets;
  const hidden = (id: string) => !visible.has(id);
  const boxes = new Map<string, Box>();
  const frameChains = new Map<string, string[]>();

  for (const id of visible) {
    const folder = foldOf(id);
    const key = folder ?? id;

    if (boxes.has(key)) {
      continue;
    }

    const chain = chainOf(key);

    chain.forEach((path, index) => {
      frameChains.set(path, chain.slice(0, index));
    });

    const folded = folder !== null;

    boxes.set(key, {
      id: key,
      kind: folded ? "folder" : "module",
      label: folded ? `${lastSegment(key)}/` : moduleLabel(key),
      parent: chain[chain.length - 1] ?? null,
      disc: input.disc(key),
      open: folded ? openIn(key) : 1,
      held: folded ? held(key) : 1,
      missingUses: folded
        ? 0
        : [...(uses.get(key) ?? [])].filter(hidden).length,
      missingUsedBy: folded
        ? 0
        : [...(usedBy.get(key) ?? [])].filter(hidden).length,
    });
  }

  const frames: Frame[] = [...frameChains.entries()]
    .sort((a, b) => a[1].length - b[1].length || (a[0] < b[0] ? -1 : 1))
    .map(([path, chain]) => ({
      path,
      label: lastSegment(path),
      parent: chain[chain.length - 1] ?? null,
      disc: input.disc(path),
      open: openIn(path),
      held: held(path),
    }));

  const groups = new Map<
    string,
    {
      from: string;
      to: string;
      style: EdgeStyle;
      edges: ScanEdge[];
    }
  >();

  for (const edge of allEdges) {
    if (!visible.has(edge.from) || !visible.has(edge.to)) {
      continue;
    }

    if (edge.inferred && !input.showInferred) {
      continue;
    }

    const from = boxOf(edge.from);
    const to = boxOf(edge.to);

    if (from === to) {
      continue;
    }

    const style = styleOf(edge, members);
    const key = `${from}\u0000${to}\u0000${style}`;
    const group = groups.get(key) ?? {
      from,
      to,
      style,
      edges: [],
    };

    group.edges.push(edge);
    groups.set(key, group);
  }

  const lines: Line[] = [...groups.values()].map((group) => ({
    id: lineId(group.from, group.to, group.style, group.edges),
    from: group.from,
    to: group.to,
    style: group.style,
    count: group.edges.length,
    edges: group.edges,
  }));

  function counts(selection: NonNullable<Selection>): Counts {
    if (selection.kind === "edge") {
      return { uses: 0, usedBy: 0 };
    }

    if (selection.kind === "module") {
      return moduleCounts(sets, selection.id);
    }

    return folderCounts(sets, input.modules, selection.id);
  }

  return { frames, boxes: [...boxes.values()], lines, counts, held, openIn };
}

export function edgesOf(
  graph: CanvasGraph,
  selection: Selection,
): Set<string> | null {
  if (selection === null) {
    return null;
  }

  if (selection.kind === "edge") {
    return new Set([selection.id]);
  }

  const touches = (box: string) =>
    selection.kind === "module"
      ? box === selection.id
      : under(box, selection.id);

  return new Set(
    graph.lines
      .filter((line) => touches(line.from) || touches(line.to))
      .map((line) => line.id),
  );
}

export function neighbourhoodOf(
  graph: CanvasGraph,
  selection: Selection,
): Set<string> | null {
  if (selection === null || selection.kind === "edge") {
    return null;
  }

  const touches = (box: string) =>
    selection.kind === "module"
      ? box === selection.id
      : under(box, selection.id);
  const near = new Set<string>();

  for (const box of graph.boxes) {
    if (touches(box.id)) {
      near.add(box.id);
    }
  }

  for (const line of graph.lines) {
    if (touches(line.from)) {
      near.add(line.to);
    }

    if (touches(line.to)) {
      near.add(line.from);
    }
  }

  return near;
}

export function presenceOf(graph: CanvasGraph) {
  return {
    module: (id: string) =>
      graph.boxes.some((box) => box.kind === "module" && box.id === id),
    folder: (path: string) =>
      graph.frames.some((frame) => frame.path === path && frame.open > 0) ||
      graph.boxes.some((box) => box.kind === "folder" && box.id === path),
    edge: (id: string) => graph.lines.some((line) => line.id === id),
  };
}

export function frameFigure(frame: Pick<Frame, "open" | "held">): string {
  return `${frame.open} of ${frame.held}`;
}

export function boxSubline(box: Box): string {
  return box.kind === "folder" ? `${box.open} open, folded` : "";
}

export function boxFigures(box: Box): string {
  if (box.kind === "folder") {
    return "";
  }

  return [
    box.missingUses > 0 ? `+${box.missingUses}↓` : "",
    box.missingUsedBy > 0 ? `+${box.missingUsedBy}↑` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
