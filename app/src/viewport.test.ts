import { describe, expect, it } from "vitest";
import {
  atMax,
  atMin,
  centerOn,
  fitToBounds,
  MAX_ZOOM,
  MIN_ZOOM,
  zoomAt,
  zoomLabel,
} from "./viewport";

describe("viewport", () => {
  it("keeps the pointed-at world point fixed while zooming", () => {
    const start = { x: 30, y: 20, k: 1 };
    const point = { x: 200, y: 100 };
    const world = {
      x: (point.x - start.x) / start.k,
      y: (point.y - start.y) / start.k,
    };
    const next = zoomAt(start, 1.5, point);

    expect(world.x * next.k + next.x).toBeCloseTo(point.x);
    expect(world.y * next.k + next.y).toBeCloseTo(point.y);
  });

  it("clamps exactly at the bounds and flips atMin and atMax on them", () => {
    const low = zoomAt({ x: 0, y: 0, k: 0.11 }, 0.01, { x: 0, y: 0 });
    const high = zoomAt({ x: 0, y: 0, k: 2.4 }, 10, { x: 0, y: 0 });

    expect(low.k).toBe(MIN_ZOOM);
    expect(high.k).toBe(MAX_ZOOM);
    expect(atMin(low)).toBe(true);
    expect(atMax(high)).toBe(true);
    expect(atMin({ x: 0, y: 0, k: 0.1001 })).toBe(false);
    expect(atMax({ x: 0, y: 0, k: 2.4999 })).toBe(false);
  });

  it("never fits above 100%", () => {
    const fitted = fitToBounds(
      { x: 0, y: 0, width: 50, height: 20 },
      { width: 1000, height: 800 },
    );

    expect(fitted.k).toBe(1);
    expect(fitted.x).toBe((1000 - 50) / 2);
  });

  it("fits a large drawing smaller and never below the minimum", () => {
    const size = { width: 800, height: 600 };

    expect(
      fitToBounds({ x: 0, y: 0, width: 4000, height: 100 }, size).k,
    ).toBeLessThan(1);
    expect(fitToBounds({ x: 0, y: 0, width: 1e9, height: 1e9 }, size).k).toBe(
      MIN_ZOOM,
    );
  });

  it("centres on a rectangle", () => {
    const next = centerOn(
      { x: 0, y: 0, k: 2 },
      { x: 100, y: 50, width: 20, height: 10 },
      { width: 800, height: 600 },
    );

    expect(110 * 2 + next.x).toBe(400);
    expect(55 * 2 + next.y).toBe(300);
  });

  it("shows the zoom as a percentage", () => {
    expect(zoomLabel({ x: 0, y: 0, k: 1.234 })).toBe("123%");
  });
});
