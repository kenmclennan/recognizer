import { describe, expect, it } from "vitest";
import type { Rect } from "./canvas-layout";
import {
  headingAnchor,
  headingMetrics,
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
const measureAt = () => measure;

describe("headingAnchor", () => {
  it("centres on one top-level frame", () => {
    expect(
      headingAnchor(
        scene(
          [frame("a", rect(60, 150, 780, 300))],
          [box("a/x", rect(70, 180, 100, 40), "a")],
        ),
      ),
    ).toEqual({ centre: 450, top: 150, width: 780 });
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
    ).toEqual({ centre: 460, top: 200, width: 680 });
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
    ).toEqual({ centre: 200, top: 100, width: 400 });
  });

  it("uses the modules' extent when there are no frames", () => {
    expect(
      headingAnchor(
        scene(
          [],
          [box("x", rect(100, 50, 100, 40)), box("y", rect(300, 80, 100, 40))],
        ),
      ),
    ).toEqual({ centre: 250, top: 50, width: 300 });
  });

  it("lets a loose box above a frame set the top", () => {
    expect(
      headingAnchor(
        scene(
          [frame("a", rect(0, 200, 400, 100))],
          [box("x", rect(0, 60, 400, 40))],
        ),
      ),
    ).toEqual({ centre: 200, top: 60, width: 400 });
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

describe("headingMetrics", () => {
  it("is the floor at a narrow diagram", () => {
    const m = headingMetrics(610);

    expect(m.titleSize).toBe(17);
    expect(m.descriptionSize).toBe(12);
    expect(m.wrapWidth).toBe(720);
    expect(m.gap).toBe(16);
  });

  it("scales with a 2810-wide diagram", () => {
    const m = headingMetrics(2810);

    expect(Math.round(m.titleSize)).toBe(62);
    expect(Math.round(m.descriptionSize)).toBe(38);
    expect(m.titleLine).toBeCloseTo(m.titleSize * 1.2);
    expect(m.descriptionLine).toBeCloseTo(m.descriptionSize * 1.45);
    expect(m.titleToDescription).toBeCloseTo(m.titleSize * 0.25);
    expect(m.gap).toBeCloseTo(m.titleSize * 0.8);
    expect(m.wrapWidth).toBeCloseTo(2248);
  });

  it("stops at the ceiling on a 4010-wide diagram", () => {
    const m = headingMetrics(4010);

    expect(m.titleSize).toBe(64);
    expect(Math.round(m.descriptionSize)).toBe(40);
  });

  it("holds the floor and the ceiling at their widths", () => {
    expect(headingMetrics(0).titleSize).toBe(17);
    expect(headingMetrics(100000).titleSize).toBe(64);
  });
});

describe("layoutHeading", () => {
  const anchor = { centre: 450, top: 150, width: 610 };

  it("places title and description above the anchor", () => {
    const layout = layoutHeading(
      { title: "T", description: "aaa bbb" },
      anchor,
      measureAt,
      measureAt,
    );

    expect(layout?.rect).toEqual({
      x: 90,
      y: 150 - (17 * 1.2 + 17 * 0.25 + 12 * 1.45) - 16,
      width: 720,
      height: 17 * 1.2 + 17 * 0.25 + 12 * 1.45,
    });
    expect(layout?.titleLines).toEqual(["T"]);
  });

  it("shows the description alone for a blank or absent title", () => {
    for (const title of [null, "   "]) {
      const layout = layoutHeading(
        { title, description: "aaa" },
        anchor,
        measureAt,
        measureAt,
      );

      expect(layout?.titleLines).toEqual([]);
      expect(layout?.rect.height).toBe(12 * 1.45);
    }
  });

  it("never caps the title", () => {
    const title = Array.from({ length: 60 }, () => "word").join(" ");
    const layout = layoutHeading(
      { title, description: "d" },
      anchor,
      measureAt,
      measureAt,
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

describe("layoutHeading with facts", () => {
  const anchor = { centre: 450, top: 150, width: 610 };
  const line = (letter: string) => letter.repeat(70);
  const paragraph = (count: number) =>
    ["a", "b", "c", "d"].slice(0, count).map(line).join(" ");
  const layout = (description: string, facts?: string[]) =>
    layoutHeading(
      { title: "T", description, ...(facts === undefined ? {} : { facts }) },
      anchor,
      measureAt,
      measureAt,
    )?.descriptionLines;

  it("shows a two-line description and one facts line as three lines with no ellipsis", () => {
    expect(layout(paragraph(2), ["facts"])).toEqual([
      line("a"),
      line("b"),
      "facts",
    ]);
  });

  it("cuts a three-line description to two lines ending in an ellipsis beside one facts line", () => {
    const lines = layout(paragraph(3), ["facts"]);

    expect(lines).toHaveLength(3);
    expect(lines?.[0]).toBe(line("a"));
    expect(lines?.[1]?.endsWith("…")).toBe(true);
    expect(lines?.[2]).toBe("facts");
  });

  it("leaves one description line beside two facts lines", () => {
    expect(layout(paragraph(3), ["one", "two"])).toEqual([
      `${line("a")}…`,
      "one",
      "two",
    ]);
  });

  it("drops the description beside three facts lines", () => {
    expect(layout(paragraph(2), ["one", "two", "three"])).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("cuts four facts lines to three with an ellipsis ending the third", () => {
    expect(layout(paragraph(2), ["one", "two", "three", "four"])).toEqual([
      "one",
      "two",
      "three…",
    ]);
  });

  it("wraps a long facts entry on its own", () => {
    const lines = layout("", [`${line("a")} ${line("b")}`]);

    expect(lines).toEqual([line("a"), line("b")]);
  });

  it("keeps the three-line cap without facts", () => {
    const lines = layout(paragraph(4));

    expect(lines).toHaveLength(3);
    expect(lines?.[2]?.endsWith("…")).toBe(true);
  });
});
