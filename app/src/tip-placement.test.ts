import { describe, expect, it } from "vitest";
import { placeTip } from "./tip-placement";

const VIEWPORT = { width: 1000, height: 600 };
const TIP = { width: 200, height: 40 };

describe("placeTip", () => {
  it("opens below the row, aligned to its left edge", () => {
    const at = placeTip(
      { left: 20, top: 100, width: 300, height: 30 },
      TIP,
      VIEWPORT,
    );

    expect(at).toEqual({ left: 20, top: 134 });
  });

  it("slides left when it would cross the right edge", () => {
    const at = placeTip(
      { left: 900, top: 100, width: 80, height: 30 },
      TIP,
      VIEWPORT,
    );

    expect(at.left + TIP.width).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it("flips above the row when it would cross the bottom edge", () => {
    const at = placeTip(
      { left: 20, top: 570, width: 300, height: 25 },
      TIP,
      VIEWPORT,
    );

    expect(at.top + TIP.height).toBeLessThanOrEqual(570);
  });

  it("stays inside the viewport when neither side fits", () => {
    const at = placeTip({ left: -50, top: 10, width: 300, height: 30 }, TIP, {
      width: 150,
      height: 60,
    });

    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.top).toBeGreaterThanOrEqual(0);
  });
});
