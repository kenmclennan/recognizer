export type Box = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };

const GAP = 4;
const MARGIN = 4;

export function placeTip(
  anchor: Box,
  tip: Size,
  viewport: Size,
): { left: number; top: number } {
  const maxLeft = Math.max(MARGIN, viewport.width - tip.width - MARGIN);
  const left = Math.min(Math.max(anchor.left, MARGIN), maxLeft);
  const below = anchor.top + anchor.height + GAP;
  const above = anchor.top - tip.height - GAP;
  const fitsBelow = below + tip.height + MARGIN <= viewport.height;
  const top = fitsBelow || above < MARGIN ? below : above;

  return {
    left,
    top: Math.max(MARGIN, Math.min(top, viewport.height - tip.height - MARGIN)),
  };
}
