import { describe, expect, it } from "vitest";
import type { Rect } from "./canvas-layout";
import {
  headingAnchor,
  layoutHeading,
  withHeading,
  wrapLines,
} from "./view-heading";

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});
const frame = (path: string, r: Rect, parent: string | null = null) =>
  ({ path, rect: r, parent }) as never;
const box = (id: string, r: Rect, parent: string | null = null) =>
  ({ id, rect: r, parent }) as never;
const scene = (frames: unknown[], boxes: unknown[]) =>
  ({ frames, boxes }) as never;
const measure = (text: string) => text.length * 10;

describe("headingAnchor", () => {
  it("centres on one top-level frame", () => {
    expect(
      headingAnchor(
        scene(
          [frame("a", rect(60, 150, 780, 300))],
          [box("a/x", rect(70, 180, 100, 40), "a")],
        ),
      ),
    ).toEqual({ centre: 450, top: 150 });
  });

  it("centres on the combined extent of two top-level frames", () => {
    expect(
      headingAnchor(
        scene(
          [
            frame("a", rect(120, 200, 300, 100)),
            frame("b", rect(480, 200, 320, 100)),
          ],
          [box("a/x", rect(130, 230, 50, 20), "a")],
        ),
      ),
    ).toEqual({ centre: 460, top: 200 });
  });

  it("counts only the outermost frames", () => {
    expect(
      headingAnchor(
        scene(
          [
            frame("a", rect(0, 100, 400, 300)),
            frame("a/b", rect(10, 20, 900, 50), "a"),
          ],
          [box("a/b/x", rect(20, 30, 10, 10), "a/b")],
        ),
      ),
    ).toEqual({ centre: 200, top: 100 });
  });

  it("uses the modules' extent when there are no frames", () => {
    expect(
      headingAnchor(
        scene(
          [],
          [box("x", rect(100, 50, 100, 40)), box("y", rect(300, 80, 100, 40))],
        ),
      ),
    ).toEqual({ centre: 250, top: 50 });
  });

  it("lets a loose box above a frame set the top", () => {
    expect(
      headingAnchor(
        scene(
          [frame("a", rect(0, 200, 400, 100))],
          [box("x", rect(0, 60, 400, 40))],
        ),
      ),
    ).toEqual({ centre: 200, top: 60 });
  });

  it("is null for an empty scene", () => {
    expect(headingAnchor(scene([], []))).toBeNull();
  });
});

describe("wrapLines", () => {
  it("keeps a short line whole", () => {
    expect(wrapLines("a b", 100, measure, 3)).toEqual(["a b"]);
  });

  it("wraps greedily on whitespace", () => {
    expect(wrapLines("aaa bbb ccc", 70, measure, 3)).toEqual([
      "aaa bbb",
      "ccc",
    ]);
  });

  it("splits one over-wide word by characters", () => {
    expect(wrapLines("abcdefgh", 30, measure, null)).toEqual([
      "abc",
      "def",
      "gh",
    ]);
  });

  it("draws exactly three lines without an ellipsis", () => {
    expect(wrapLines("aaa bbb ccc", 30, measure, 3)).toEqual([
      "aaa",
      "bbb",
      "ccc",
    ]);
  });

  it("ends the third of four lines with an ellipsis", () => {
    expect(wrapLines("aaa bbb ccc ddd", 40, measure, 3)).toEqual([
      "aaa",
      "bbb",
      "ccc…",
    ]);
  });

  it("shortens the last line until the ellipsis fits", () => {
    expect(wrapLines("aaa bbbb cccc dddd", 40, measure, 3)).toEqual([
      "aaa",
      "bbbb",
      "ccc…",
    ]);
  });
});

describe("layoutHeading", () => {
  const anchor = { centre: 450, top: 150 };

  it("places title and description above the anchor", () => {
    const layout = layoutHeading(
      { title: "T", description: "aaa bbb" },
      anchor,
      measure,
      measure,
    );

    expect(layout?.rect).toEqual({
      x: 90,
      y: 150 - (24 + 4 + 20.3) - 16,
      width: 720,
      height: 24 + 4 + 20.3,
    });
    expect(layout?.titleLines).toEqual(["T"]);
  });

  it("shows the description alone for a blank or absent title", () => {
    for (const title of [null, "   "]) {
      const layout = layoutHeading(
        { title, description: "aaa" },
        anchor,
        measure,
        measure,
      );

      expect(layout?.titleLines).toEqual([]);
      expect(layout?.rect.height).toBe(20.3);
    }
  });

  it("never caps the title", () => {
    const title = Array.from({ length: 60 }, () => "word").join(" ");
    const layout = layoutHeading(
      { title, description: "d" },
      anchor,
      measure,
      measure,
    );

    expect(layout?.titleLines.length).toBeGreaterThan(3);
    expect(layout?.titleLines.join(" ")).toBe(title);
  });
});

describe("withHeading", () => {
  it("returns the bounds when there is no heading", () => {
    expect(withHeading(rect(0, 0, 10, 10), null)).toEqual(rect(0, 0, 10, 10));
  });

  it("unions the bounds and the heading", () => {
    expect(withHeading(rect(100, 100, 200, 200), rect(0, 20, 720, 60))).toEqual(
      rect(0, 20, 720, 280),
    );
  });
});
