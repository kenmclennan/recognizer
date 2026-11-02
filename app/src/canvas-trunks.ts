import type { EdgeStyle } from "./canvas-graph";
import type { Point } from "./canvas-layout";

export const MIN_SEGMENT = 40;
export const JOIN_DISTANCE = 14;
export const MIN_LINES = 3;
export const MIN_TRUNK_LENGTH = 120;
export const TRUNK_BASE_WIDTH = 1.5;
export const TRUNK_WIDTH_PER_LOG2 = 1.6;
export const TITLE_LISTED = 12;

const AXIS_TOLERANCE = 0.5;
const COUNT_OFFSET = 4;

export type TrunkMember = {
  id: string;
  from: string;
  to: string;
  style: EdgeStyle;
};

export type TrunkInput = TrunkMember & { points: Point[] };

export type Trunk = {
  id: string;
  axis: "h" | "v";
  from: Point;
  to: Point;
  count: number;
  width: number;
  style: EdgeStyle;
  lineIds: string[];
  title: string;
  countAt: Point;
};

export type TrunkPlan = { trunks: Trunk[]; drawn: Map<string, Point[][]> };

type Segment = {
  line: number;
  index: number;
  axis: "h" | "v";
  cross: number;
  lo: number;
  hi: number;
};

type Stretch = { start: number; end: number; position: number };

export function trunkWidth(count: number): number {
  return TRUNK_BASE_WIDTH + Math.log2(count) * TRUNK_WIDTH_PER_LOG2;
}

export function trunkTitle(members: TrunkMember[]): string {
  const lines = [`${members.length} lines`];

  for (const member of members.slice(0, TITLE_LISTED)) {
    lines.push(`${member.from} -> ${member.to}`);
  }

  if (members.length > TITLE_LISTED) {
    lines.push(`and ${members.length - TITLE_LISTED} more`);
  }

  return lines.join("\n");
}

export function trunkLitCount(trunk: Trunk, lit: ReadonlySet<string>): number {
  return trunk.lineIds.filter((id) => lit.has(id)).length;
}

function extractSegments(lines: TrunkInput[]): Segment[] {
  const segments: Segment[] = [];

  lines.forEach((line, lineIndex) => {
    for (let i = 0; i + 1 < line.points.length; i++) {
      const a = line.points[i] as Point;
      const b = line.points[i + 1] as Point;
      const horizontal = Math.abs(a.y - b.y) <= AXIS_TOLERANCE;
      const vertical = Math.abs(a.x - b.x) <= AXIS_TOLERANCE;

      if (!horizontal && !vertical) {
        continue;
      }

      const axis = horizontal ? "h" : "v";
      const along = (p: Point) => (axis === "h" ? p.x : p.y);
      const across = (p: Point) => (axis === "h" ? p.y : p.x);
      const lo = Math.min(along(a), along(b));
      const hi = Math.max(along(a), along(b));

      if (hi - lo < MIN_SEGMENT) {
        continue;
      }

      segments.push({
        line: lineIndex,
        index: i,
        axis,
        cross: (across(a) + across(b)) / 2,
        lo,
        hi,
      });
    }
  });

  return segments;
}

function chainRuns(segments: Segment[]): Segment[][] {
  const parent = segments.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;

    while (parent[root] !== root) {
      root = parent[root] as number;
    }

    parent[i] = root;

    return root;
  };

  for (const axis of ["h", "v"] as const) {
    const ordered = segments
      .map((segment, i) => ({ segment, i }))
      .filter((entry) => entry.segment.axis === axis)
      .sort((a, b) => a.segment.cross - b.segment.cross);

    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i] as (typeof ordered)[number];

      for (let j = i + 1; j < ordered.length; j++) {
        const b = ordered[j] as (typeof ordered)[number];

        if (b.segment.cross - a.segment.cross > JOIN_DISTANCE) {
          break;
        }

        const overlap =
          Math.min(a.segment.hi, b.segment.hi) -
          Math.max(a.segment.lo, b.segment.lo);

        if (overlap > 0 && a.segment.line !== b.segment.line) {
          parent[find(a.i)] = find(b.i);
        }
      }
    }
  }

  const runs = new Map<number, Segment[]>();

  segments.forEach((segment, i) => {
    const root = find(i);
    const run = runs.get(root) ?? [];

    run.push(segment);
    runs.set(root, run);
  });

  return [...runs.values()];
}

function round(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function dedupe(points: Point[]): Point[] {
  return points.filter(
    (p, i) =>
      i === 0 ||
      Math.abs(p.x - (points[i - 1] as Point).x) > 1e-9 ||
      Math.abs(p.y - (points[i - 1] as Point).y) > 1e-9,
  );
}

export function planTrunks(lines: TrunkInput[]): TrunkPlan {
  const segments = extractSegments(lines);
  const trunks: Trunk[] = [];
  const stretchesBySegment = new Map<Segment, Stretch[]>();

  for (const run of chainRuns(segments)) {
    const axis = (run[0] as Segment).axis;
    const position = run.reduce((sum, s) => sum + s.cross, 0) / run.length;
    const cuts = [...new Set(run.flatMap((s) => [s.lo, s.hi]))].sort(
      (a, b) => a - b,
    );

    for (let i = 0; i + 1 < cuts.length; i++) {
      const start = cuts[i] as number;
      const end = cuts[i + 1] as number;
      const covering = run.filter((s) => s.lo <= start && s.hi >= end);

      if (covering.length < MIN_LINES || end - start < MIN_TRUNK_LENGTH) {
        continue;
      }

      const ids = [...new Set(covering.map((s) => s.line))].sort(
        (a, b) => a - b,
      );
      const members = ids.map((index) => lines[index] as TrunkInput);
      const styles = new Set(members.map((m) => m.style));
      const style: EdgeStyle =
        styles.size === 1 ? (members[0] as TrunkInput).style : "plain";
      const from: Point =
        axis === "h" ? { x: start, y: position } : { x: position, y: start };
      const to: Point =
        axis === "h" ? { x: end, y: position } : { x: position, y: end };
      const middle = (start + end) / 2;

      trunks.push({
        id: `${axis}:${round(from.x)},${round(from.y)}-${round(to.x)},${round(to.y)}`,
        axis,
        from,
        to,
        count: covering.length,
        width: trunkWidth(covering.length),
        style,
        lineIds: members.map((m) => m.id),
        title: trunkTitle(members),
        countAt:
          axis === "v"
            ? { x: position + COUNT_OFFSET, y: middle }
            : { x: middle, y: position - COUNT_OFFSET },
      });

      for (const segment of covering) {
        const list = stretchesBySegment.get(segment) ?? [];

        list.push({ start, end, position });
        stretchesBySegment.set(segment, list);
      }
    }
  }

  const byLine = new Map<number, Map<number, Segment>>();

  for (const segment of stretchesBySegment.keys()) {
    const map = byLine.get(segment.line) ?? new Map<number, Segment>();

    map.set(segment.index, segment);
    byLine.set(segment.line, map);
  }

  const drawn = new Map<string, Point[][]>();

  lines.forEach((line, lineIndex) => {
    const touched = byLine.get(lineIndex);

    if (!touched) {
      drawn.set(line.id, [line.points]);

      return;
    }

    const pieces: Point[][] = [];
    let current: Point[] = [line.points[0] as Point];

    for (let i = 0; i + 1 < line.points.length; i++) {
      const q = line.points[i + 1] as Point;
      const segment = touched.get(i);

      if (segment) {
        const p = line.points[i] as Point;
        const horizontal = segment.axis === "h";
        const along = (pt: Point) => (horizontal ? pt.x : pt.y);
        const make = (a: number, c: number): Point =>
          horizontal ? { x: a, y: c } : { x: c, y: a };
        const direction = along(q) >= along(p) ? 1 : -1;
        const stretches = [
          ...(stretchesBySegment.get(segment) as Stretch[]),
        ].sort((a, b) => direction * (a.start - b.start));

        for (const stretch of stretches) {
          const entry = direction > 0 ? stretch.start : stretch.end;
          const exit = direction > 0 ? stretch.end : stretch.start;
          const offset = Math.min(
            Math.abs(segment.cross - stretch.position),
            (stretch.end - stretch.start) / 2,
          );

          current.push(make(entry, segment.cross));
          current.push(make(entry + direction * offset, stretch.position));
          pieces.push(current);
          current = [
            make(exit - direction * offset, stretch.position),
            make(exit, segment.cross),
          ];
        }
      }

      current.push(q);
    }

    pieces.push(current);
    drawn.set(
      line.id,
      pieces.map(dedupe).filter((piece) => piece.length >= 2),
    );
  });

  return { trunks, drawn };
}
