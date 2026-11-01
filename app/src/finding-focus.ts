import type { FindingRecord } from "recognizer";
import type { Rect } from "./canvas-layout";
import type { Scene } from "./canvas-scene";
import type { Selection } from "./canvas-state";
import { evidenceLines, offCanvasModules } from "./findings-card";

export type Ghost = {
  id: string;
  name: string;
  partner: string;
  rect: Rect;
  edge: { from: string; to: string } | null;
};

export type RowDetail = {
  lines: string[];
  fix: string;
  open: { module: string; line: number | null };
};

export const GHOST_GAP = 40;
export const GHOST_STACK_GAP = 16;

const identity = (id: string) => id;

export function keepsFocus(
  selection: Selection,
  record: FindingRecord,
  boxFor: (id: string) => string = identity,
): boolean {
  if (selection === null || selection.kind === "edge") {
    return false;
  }

  const ids = new Set(record.evidence.modules);

  for (const edge of record.evidence.edges ?? []) {
    ids.add(edge.from);
    ids.add(edge.to);
  }

  return [...ids].some((id) => boxFor(id) === selection.id);
}

export function rowDetail(record: FindingRecord): RowDetail {
  const first = record.evidence.edges?.[0];
  const line = first?.lines?.[0];

  return {
    lines: evidenceLines(record),
    fix: record.fix_pattern ?? "no fix pattern recorded",
    open:
      first !== undefined && line !== undefined
        ? { module: first.from, line }
        : { module: record.evidence.modules[0] as string, line: null },
  };
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function ghostPlacement(
  record: FindingRecord,
  boxFor: (id: string) => string,
  scene: Scene,
): Ghost[] {
  const boxes = new Map(scene.boxes.map((box) => [box.id, box]));
  const off = offCanvasModules(record, boxFor, new Set(boxes.keys()));
  const edges = record.evidence.edges ?? [];
  const stacked = new Map<string, number>();
  const ghosts: Ghost[] = [];

  for (const id of off) {
    const edge = edges.find((one) => one.from === id || one.to === id);
    const other =
      edge === undefined
        ? record.evidence.modules[0]
        : edge.from === id
          ? edge.to
          : edge.from;
    const partner = boxes.get(boxFor(other as string));

    if (partner === undefined) {
      continue;
    }

    const below = stacked.get(partner.id) ?? 0;

    stacked.set(partner.id, below + 1);
    ghosts.push({
      id,
      name: fileName(id),
      partner: partner.id,
      rect: {
        x: partner.rect.x + partner.rect.width + GHOST_GAP,
        y: partner.rect.y + below * (partner.rect.height + GHOST_STACK_GAP),
        width: partner.rect.width,
        height: partner.rect.height,
      },
      edge: edge === undefined ? null : { from: edge.from, to: edge.to },
    });
  }

  return ghosts;
}
