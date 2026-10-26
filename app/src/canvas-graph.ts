import type { Scan, ScanEdge } from "recognizer";
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
  ghost: boolean;
};

export type Line = {
  id: string;
  from: string;
  to: string;
  style: EdgeStyle;
  count: number;
  edges: ScanEdge[];
  ghost: boolean;
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
  ghosts: ReadonlySet<string>;
};

export function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function moduleLabel(id: string): string {
  const name = lastSegment(id);
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(0, dot) : name;
}

export function folderChain(id: string): string[] {
  const parts = id.split("/");

  return parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function under(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

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

function neighbourSets(edges: ScanEdge[], known: Set<string>) {
  const uses = new Map<string, Set<string>>();
  const usedBy = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (edge.from === edge.to || !known.has(edge.from) || !known.has(edge.to)) {
      continue;
    }

    uses.set(edge.from, (uses.get(edge.from) ?? new Set()).add(edge.to));
    usedBy.set(edge.to, (usedBy.get(edge.to) ?? new Set()).add(edge.from));
  }

  return { uses, usedBy };
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

  const { uses, usedBy } = neighbourSets(allEdges, known);
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
      label: folded ? lastSegment(key) : moduleLabel(key),
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
      ghost: false,
    });
  }

  const openSet = new Set(input.opened);
  const drawnGhosts = new Set(
    [...input.ghosts].filter(
      (id) =>
        known.has(id) && !openSet.has(id) && inFocus(id) && foldOf(id) === null,
    ),
  );

  for (const id of drawnGhosts) {
    const chain = chainOf(id);

    chain.forEach((path, index) => {
      frameChains.set(path, chain.slice(0, index));
    });

    boxes.set(id, {
      id,
      kind: "module",
      label: moduleLabel(id),
      parent: chain[chain.length - 1] ?? null,
      disc: input.disc(id),
      open: 1,
      held: 1,
      missingUses: 0,
      missingUsedBy: 0,
      ghost: true,
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
      ghost: boolean;
    }
  >();
  const shown = (id: string) => visible.has(id) || drawnGhosts.has(id);

  for (const edge of allEdges) {
    if (!shown(edge.from) || !shown(edge.to)) {
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
      ghost: drawnGhosts.has(edge.from) || drawnGhosts.has(edge.to),
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
    ghost: group.ghost,
  }));

  function counts(selection: NonNullable<Selection>): Counts {
    if (selection.kind === "edge") {
      return { uses: 0, usedBy: 0 };
    }

    if (selection.kind === "module") {
      return {
        uses: uses.get(selection.id)?.size ?? 0,
        usedBy: usedBy.get(selection.id)?.size ?? 0,
      };
    }

    const inside = input.modules.filter((id) => under(id, selection.id));
    const reached = new Set<string>();
    const reaching = new Set<string>();

    for (const id of inside) {
      for (const other of uses.get(id) ?? []) {
        if (!under(other, selection.id)) {
          reached.add(other);
        }
      }

      for (const other of usedBy.get(id) ?? []) {
        if (!under(other, selection.id)) {
          reaching.add(other);
        }
      }
    }

    return { uses: reached.size, usedBy: reaching.size };
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
      .filter((line) => !line.ghost && (touches(line.from) || touches(line.to)))
      .map((line) => line.id),
  );
}

export function presenceOf(graph: CanvasGraph) {
  return {
    module: (id: string) =>
      graph.boxes.some(
        (box) => box.kind === "module" && box.id === id && !box.ghost,
      ),
    folder: (path: string) =>
      graph.frames.some((frame) => frame.path === path && frame.open > 0) ||
      graph.boxes.some((box) => box.kind === "folder" && box.id === path),
    edge: (id: string) => graph.lines.some((line) => line.id === id),
  };
}

export function frameFigure(frame: Pick<Frame, "open" | "held">): string {
  return `${frame.open} of ${frame.held}`;
}

export function boxFigures(box: Box): string {
  if (box.kind === "folder") {
    return `${box.open} of ${box.held}`;
  }

  return [
    box.missingUses > 0 ? `↑${box.missingUses}` : "",
    box.missingUsedBy > 0 ? `↓${box.missingUsedBy}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
