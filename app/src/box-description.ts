import type { Scheduler } from "./bar-hover";

export const BOX_DESCRIPTION_DELAY_MS = 250;
export const BOX_DESCRIPTION_GAP = 8;
export const BOX_DESCRIPTION_MARGIN = 8;

export type DescriptionHover = {
  enter: (id: string) => void;
  leave: () => void;
  reset: () => void;
  shown: () => string | null;
};

export type DescriptionBox = {
  left: number;
  top: number;
  bottom: number;
  width: number;
};

export type DescriptionArea = { top: number; bottom: number };

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
  };
}

export function placeDescription(
  box: DescriptionBox,
  height: number,
  area: DescriptionArea,
  bar: { top: number } | null,
): DescriptionPlace | null {
  const below = box.bottom + BOX_DESCRIPTION_GAP;

  if (below + height + BOX_DESCRIPTION_MARGIN <= area.bottom) {
    return { left: box.left, width: box.width, top: below };
  }

  const above =
    Math.min(box.top, bar?.top ?? box.top) - BOX_DESCRIPTION_GAP - height;

  if (above >= area.top + BOX_DESCRIPTION_MARGIN) {
    return { left: box.left, width: box.width, top: above };
  }

  return null;
}
