import type { Scheduler } from "./bar-hover";

export const BOX_DESCRIPTION_DELAY_MS = 250;
export const BOX_DESCRIPTION_GAP = 8;
export const BOX_DESCRIPTION_MARGIN = 8;
export const BOX_DESCRIPTION_WIDTH = 320;

export type DescriptionHover = {
  enter: (id: string) => void;
  leave: () => void;
  reset: () => void;
  shown: () => string | null;
  held: () => string | null;
};

export type DescriptionBox = {
  left: number;
  top: number;
  bottom: number;
  width: number;
};

export type DescriptionArea = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type DescriptionNoteSide = "left" | "right" | null;

export type DescriptionPlace = { left: number; width: number; top: number };

export function createDescriptionHover(
  scheduler: Scheduler,
  onChange: (id: string | null) => void,
): DescriptionHover {
  let shown: string | null = null;
  let pendingId: string | null = null;
  let pending: unknown = null;

  const cancelPending = () => {
    if (pendingId !== null) {
      scheduler.cancel(pending);
      pendingId = null;
      pending = null;
    }
  };
  const hide = () => {
    if (shown !== null) {
      shown = null;
      onChange(null);
    }
  };

  return {
    enter(id) {
      if (id === shown || id === pendingId) {
        return;
      }

      cancelPending();
      hide();
      pendingId = id;
      pending = scheduler.after(() => {
        pendingId = null;
        pending = null;
        shown = id;
        onChange(id);
      }, BOX_DESCRIPTION_DELAY_MS);
    },
    leave() {
      cancelPending();
      hide();
    },
    reset() {
      cancelPending();
      hide();
    },
    shown: () => shown,
    held: () => shown ?? pendingId,
  };
}

export function descriptionSurvives(
  held: string | null,
  sceneRedrawn: boolean,
  selectionUnchanged: boolean,
  previousText: string | null,
  nextText: string | null,
): boolean {
  return (
    held !== null &&
    !sceneRedrawn &&
    selectionUnchanged &&
    previousText === nextText
  );
}

function placeAcross(
  box: DescriptionBox,
  area: DescriptionArea,
  note: DescriptionNoteSide,
): { left: number; width: number } {
  const width = Math.max(
    0,
    Math.min(
      BOX_DESCRIPTION_WIDTH,
      area.right - area.left - 2 * BOX_DESCRIPTION_MARGIN,
    ),
  );
  const wanted =
    note === "right"
      ? box.left + box.width - width
      : note === "left"
        ? box.left
        : box.left + box.width / 2 - width / 2;
  const low = area.left + BOX_DESCRIPTION_MARGIN;
  const high = area.right - BOX_DESCRIPTION_MARGIN - width;

  return { left: Math.max(low, Math.min(wanted, high)), width };
}

export function placeDescription(
  box: DescriptionBox,
  height: number,
  area: DescriptionArea,
  bar: { top: number } | null,
  note: DescriptionNoteSide = null,
): DescriptionPlace | null {
  const across = placeAcross(box, area, note);
  const below = box.bottom + BOX_DESCRIPTION_GAP;

  if (below + height + BOX_DESCRIPTION_MARGIN <= area.bottom) {
    return { ...across, top: below };
  }

  const above =
    Math.min(box.top, bar?.top ?? box.top) - BOX_DESCRIPTION_GAP - height;

  if (above >= area.top + BOX_DESCRIPTION_MARGIN) {
    return { ...across, top: above };
  }

  return null;
}
