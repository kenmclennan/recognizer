import type { Rect } from "./canvas-layout";
import { BUBBLE_GAP } from "./note-focus";

export type PanViewport = { x: number; y: number; k: number };

export type WalkthroughInput = {
  box: Rect;
  side: "right" | "left";
  bubbleWidth: number;
  anchor: { x: number; y: number };
  k: number;
};

export function walkthroughViewport(input: WalkthroughInput): PanViewport {
  const { box, side, bubbleWidth, anchor, k } = input;
  const edge =
    side === "right"
      ? box.x + box.width + BUBBLE_GAP
      : box.x - BUBBLE_GAP - bubbleWidth;

  return { x: anchor.x - edge * k, y: anchor.y - box.y * k, k };
}

export function easeViewport(
  from: PanViewport,
  to: PanViewport,
  t: number,
): PanViewport {
  const clamped = Math.min(1, Math.max(0, t));
  const eased = 1 - (1 - clamped) ** 3;

  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
    k: to.k,
  };
}
