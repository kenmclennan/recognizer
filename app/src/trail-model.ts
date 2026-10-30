import { lastSegment } from "./canvas-graph";
import type { Selection } from "./canvas-state";
import type { Direction, Followed, InspectorTab } from "./inspector-model";

export const STRIP_WIDTH = 28;
export const CANVAS_FLOOR = 400;
export const RAIL_WIDTH = 40;
export const MAX_PANELS = 3;

export type TrailPanel = {
  selection: Selection;
  relation: Direction | null;
  followed: Followed | null;
  tab: InspectorTab;
  filter: string;
  folds: ReadonlySet<string>;
  groupFlips: ReadonlySet<string>;
  focusedRow: string | null;
};

export type Trail = {
  panels: TrailPanel[];
  start: number;
  active: number;
  cap: number;
};

export type TrailLayout = {
  strips: number[];
  shown: number[];
  later: number[];
};

export type Crumb = {
  index: number;
  label: string;
  relation: "uses" | "used by" | null;
};

export type TrailKeyAction =
  | "up"
  | "down"
  | "follow"
  | "back"
  | "tick"
  | "close-last"
  | "put-on-canvas";

export type TrailKeyInput = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

function freshPanel(
  selection: Selection,
  relation: Direction | null,
  tab: InspectorTab,
): TrailPanel {
  return {
    selection,
    relation,
    followed: null,
    tab,
    filter: "",
    folds: new Set(),
    groupFlips: new Set(),
    focusedRow: null,
  };
}

function windowStart(length: number, cap: number): number {
  return Math.max(0, length - cap);
}

export function startTrail(selection: Selection, tab: InspectorTab): Trail {
  return {
    panels: [freshPanel(selection, null, tab)],
    start: 0,
    active: 0,
    cap: MAX_PANELS,
  };
}

export function isFollowed(
  trail: Trail,
  from: number,
  relation: Direction,
  id: string,
): boolean {
  const followed = trail.panels[from]?.followed;

  return followed?.id === id && followed.relation === relation;
}

export function follow(
  trail: Trail,
  from: number,
  relation: Direction,
  id: string,
): Trail {
  if (from < 0 || from >= trail.panels.length) {
    return trail;
  }

  if (isFollowed(trail, from, relation, id)) {
    return trail;
  }

  const kept = trail.panels.slice(0, from + 1);

  kept[from] = { ...kept[from], followed: { id, relation } };

  const panels = [
    ...kept,
    freshPanel({ kind: "module", id }, relation, "dependencies"),
  ];

  return {
    ...trail,
    panels,
    active: panels.length - 1,
    start: windowStart(panels.length, trail.cap),
  };
}

export function close(trail: Trail, index: number): Trail {
  if (index < 1 || index >= trail.panels.length) {
    return trail;
  }

  const panels = trail.panels.slice(0, index);
  const last = panels.length - 1;

  panels[last] = { ...panels[last], followed: null };

  return {
    ...trail,
    panels,
    active: last,
    start: windowStart(panels.length, trail.cap),
  };
}

export function layout(trail: Trail): TrailLayout {
  const length = trail.panels.length;
  const end = Math.min(length, trail.start + trail.cap);
  const range = (from: number, to: number) =>
    Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

  return {
    strips: range(0, Math.min(trail.start, length)),
    shown: range(trail.start, end),
    later: range(end, length),
  };
}

export function bringBack(trail: Trail, index: number): Trail {
  if (index < 0 || index >= trail.panels.length) {
    return trail;
  }

  if (index < trail.start) {
    return { ...trail, start: index, active: index };
  }

  if (index >= trail.start + trail.cap) {
    return { ...trail, start: index - (trail.cap - 1), active: index };
  }

  return { ...trail, active: index };
}

export function panelCapacity(
  available: number,
  panelWidth: number,
  count: number,
): number {
  for (let n = MAX_PANELS; n >= 2; n -= 1) {
    const shown = Math.min(n, count);

    if (shown * panelWidth + STRIP_WIDTH * (count - shown) <= available) {
      return n;
    }
  }

  return 1;
}

export function withCapacity(trail: Trail, cap: number): Trail {
  const length = trail.panels.length;
  const narrowed =
    cap < trail.cap
      ? Math.max(trail.start, trail.active - cap + 1)
      : trail.start;
  const start = Math.max(0, Math.min(narrowed, length - cap));

  if (cap === trail.cap && start === trail.start) {
    return trail;
  }

  return { ...trail, cap, start };
}

export function updatePanel(
  trail: Trail,
  index: number,
  patch: Partial<TrailPanel>,
): Trail {
  if (index < 0 || index >= trail.panels.length) {
    return trail;
  }

  const panels = trail.panels.slice();

  panels[index] = { ...panels[index], ...patch };

  return { ...trail, panels };
}

export function labelOf(selection: Selection): string {
  if (selection === null) {
    return "Inspector";
  }

  if (selection.kind === "edge") {
    return "Edge";
  }

  return selection.kind === "folder"
    ? `${lastSegment(selection.id)}/`
    : lastSegment(selection.id);
}

export function crumbs(trail: Trail): Crumb[] {
  return trail.panels.map((panel, index) => ({
    index,
    label: labelOf(panel.selection),
    relation:
      panel.relation === null
        ? null
        : panel.relation === "uses"
          ? "uses"
          : "used by",
  }));
}

export function trailModules(trail: Trail): string[] {
  const ids: string[] = [];

  for (const panel of trail.panels) {
    const selection = panel.selection;

    if (
      selection !== null &&
      selection.kind === "module" &&
      !ids.includes(selection.id)
    ) {
      ids.push(selection.id);
    }
  }

  return ids;
}

export function missingFromCanvas(
  trail: Trail,
  onCanvas: (id: string) => boolean,
): string[] {
  return trailModules(trail).filter((id) => !onCanvas(id));
}

export function reconcile(trail: Trail, known: ReadonlySet<string>): Trail {
  const gone = trail.panels.findIndex((panel, index) => {
    const selection = panel.selection;

    return (
      index >= 1 &&
      selection !== null &&
      selection.kind === "module" &&
      !known.has(selection.id)
    );
  });

  return gone === -1 ? trail : close(trail, gone);
}

export function trailKeyAction(
  event: TrailKeyInput,
  targetEditable: boolean,
): TrailKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey || targetEditable) {
    return null;
  }

  switch (event.key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowRight":
      return "follow";
    case "ArrowLeft":
      return "back";
    case " ":
      return "tick";
    case "Escape":
      return "close-last";
    case "p":
    case "P":
      return "put-on-canvas";
    default:
      return null;
  }
}

export function moveFocus(
  rowIds: string[],
  current: string | null,
  direction: "up" | "down",
): string | null {
  if (rowIds.length === 0) {
    return null;
  }

  const at = current === null ? -1 : rowIds.indexOf(current);

  if (at === -1) {
    return direction === "down" ? rowIds[0] : rowIds[rowIds.length - 1];
  }

  const next = Math.min(
    rowIds.length - 1,
    Math.max(0, at + (direction === "down" ? 1 : -1)),
  );

  return rowIds[next];
}

export function rowKey(followed: Followed): string {
  return `${followed.relation}:${followed.id}`;
}
