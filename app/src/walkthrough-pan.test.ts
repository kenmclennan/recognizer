import { describe, expect, it } from "vitest";
import { easeViewport, walkthroughViewport } from "./walkthrough-pan";

const box = { x: 100, y: 200, width: 80, height: 40 };
const anchor = { x: 400, y: 120 };

describe("walkthroughViewport", () => {
  it("puts the bubble beside the box's right edge at zoom 1", () => {
    const viewport = walkthroughViewport({
      box,
      side: "right",
      bubbleWidth: 240,
      anchor,
      k: 1,
    });

    expect(viewport).toEqual({ x: 400 - 190, y: 120 - 200, k: 1 });
  });

  it("puts the bubble beside the box's left edge", () => {
    const viewport = walkthroughViewport({
      box,
      side: "left",
      bubbleWidth: 240,
      anchor,
      k: 1,
    });

    expect(viewport.x).toBe(400 - (100 - 10 - 240));
    expect(viewport.y).toBe(-80);
  });

  it("scales the box position by the zoom", () => {
    const viewport = walkthroughViewport({
      box,
      side: "right",
      bubbleWidth: 240,
      anchor,
      k: 0.5,
    });

    expect(viewport).toEqual({ x: 400 - 95, y: 120 - 100, k: 0.5 });
  });

  it("leaves the viewport unchanged when the box already sits beside the anchor", () => {
    const current = { x: 210, y: -80, k: 1 };
    const next = walkthroughViewport({
      box,
      side: "right",
      bubbleWidth: 240,
      anchor: {
        x: current.x + 190,
        y: current.y + 200,
      },
      k: 1,
    });

    expect(next).toEqual(current);
  });
});

describe("easeViewport", () => {
  const from = { x: 0, y: 0, k: 1 };
  const to = { x: 100, y: -50, k: 1 };

  it("starts at from and ends at to", () => {
    expect(easeViewport(from, to, 0)).toEqual(from);
    expect(easeViewport(from, to, 1)).toEqual(to);
  });

  it("eases out so the middle is past halfway", () => {
    const mid = easeViewport(from, to, 0.5);

    expect(mid.x).toBeGreaterThan(50);
    expect(mid.x).toBeLessThan(100);
    expect(mid.y / mid.x).toBeCloseTo(-0.5);
  });

  it("clamps t outside 0 to 1", () => {
    expect(easeViewport(from, to, -3)).toEqual(from);
    expect(easeViewport(from, to, 9)).toEqual(to);
  });
});
