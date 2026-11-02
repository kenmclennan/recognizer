import type { View } from "recognizer";
import { describe, expect, it } from "vitest";
import type { Rect } from "./canvas-layout";
import {
  BUBBLE_EDGE,
  BUBBLE_GAP,
  bubblePlace,
  bubbleSet,
  keepsFocus,
  notePathOf,
  noteRows,
  walkNotes,
} from "./note-focus";

const rect = (x: number, y: number): Rect => ({ x, y, width: 100, height: 30 });

const viewOf = (...paths: string[]): View => ({
  schema_version: 3,
  description: "d",
  commit: null,
  notes: paths.map((module) => ({ module, text: `t ${module}`, by: "Ken" })),
  steps: [],
});

describe("notePathOf", () => {
  it("is the id for a module, the id and a slash for a folder, and null otherwise", () => {
    expect(notePathOf({ kind: "module", id: "a/b.py" })).toBe("a/b.py");
    expect(notePathOf({ kind: "folder", id: "a/b" })).toBe("a/b/");
    expect(notePathOf({ kind: "edge", id: "x" })).toBeNull();
    expect(notePathOf(null)).toBeNull();
  });
});

describe("keepsFocus", () => {
  const focus = { path: "a.py" };

  it("keeps the same box and drops another box, an edge and nothing", () => {
    expect(keepsFocus({ kind: "module", id: "a.py" }, focus)).toBe(true);
    expect(keepsFocus({ kind: "module", id: "b.py" }, focus)).toBe(false);
    expect(keepsFocus({ kind: "edge", id: "a.py" }, focus)).toBe(false);
    expect(keepsFocus(null, focus)).toBe(false);
  });

  it("keeps a folder selected by its frame under the path with a slash", () => {
    expect(keepsFocus({ kind: "folder", id: "pkg" }, { path: "pkg/" })).toBe(
      true,
    );
    expect(keepsFocus({ kind: "folder", id: "pkg" }, { path: "pkg" })).toBe(
      false,
    );
  });
});

describe("noteRows", () => {
  it("orders rows on the canvas by top then left, folders by their frame, then path on a tie", () => {
    const positions = new Map<string, Rect>([
      ["b.py", rect(200, 100)],
      ["a.py", rect(0, 100)],
      ["pkg/", rect(500, 0)],
      ["c.py", rect(0, 100)],
    ]);
    const rows = noteRows(
      viewOf("b.py", "c.py", "a.py", "pkg/"),
      positions,
      null,
    );

    expect(rows.map((row) => row.path)).toEqual([
      "pkg/",
      "a.py",
      "c.py",
      "b.py",
    ]);
    expect(rows.map((row) => row.kind)).toEqual([
      "folder",
      "module",
      "module",
      "module",
    ]);
  });

  it("puts off-canvas rows last by path, flagged off, and drops none", () => {
    const positions = new Map<string, Rect>([["b.py", rect(0, 0)]]);
    const rows = noteRows(viewOf("z.py", "b.py", "a/"), positions, null);

    expect(rows.map((row) => [row.path, row.off])).toEqual([
      ["b.py", false],
      ["a/", true],
      ["z.py", true],
    ]);
  });

  it("marks the active row and carries the text and author", () => {
    const rows = noteRows(
      viewOf("a.py", "b.py"),
      new Map([
        ["a.py", rect(0, 0)],
        ["b.py", rect(0, 50)],
      ]),
      "b.py",
    );

    expect(rows.map((row) => row.active)).toEqual([false, true]);
    expect(rows[0]).toMatchObject({ text: "t a.py", by: "Ken" });
  });

  it("returns no rows for a view with no notes", () => {
    expect(
      noteRows({ ...viewOf(), notes: undefined }, new Map(), null),
    ).toEqual([]);
  });
});

describe("walkNotes", () => {
  const rows = noteRows(
    viewOf("a.py", "b.py", "c.py", "gone.py"),
    new Map([
      ["a.py", rect(0, 0)],
      ["b.py", rect(0, 50)],
      ["c.py", rect(0, 100)],
    ]),
    null,
  );

  it("starts at the first row going forward and the last going back from no active row", () => {
    expect(walkNotes(rows, null, 1)).toBe("a.py");
    expect(walkNotes(rows, null, -1)).toBe("c.py");
  });

  it("steps through the rows on the canvas and stops at both ends", () => {
    expect(walkNotes(rows, "a.py", 1)).toBe("b.py");
    expect(walkNotes(rows, "b.py", -1)).toBe("a.py");
    expect(walkNotes(rows, "a.py", -1)).toBe("a.py");
    expect(walkNotes(rows, "c.py", 1)).toBe("c.py");
  });

  it("keeps the active path when no row is on the canvas", () => {
    expect(walkNotes([], "x.py", 1)).toBe("x.py");
  });
});

describe("bubblePlace", () => {
  const box: Rect = { x: 100, y: 100, width: 200, height: 28 };
  const mark: Rect = { x: 280, y: 110, width: 14, height: 14 };
  const size = { width: 240, height: 80 };
  const view: Rect = { x: 0, y: 0, width: 800, height: 600 };

  it("sits to the right of the box, top aligned, tail on its left edge at the mark", () => {
    const place = bubblePlace(box, mark, size, view);

    expect(place.side).toBe("right");
    expect(place.left).toBe(300 + BUBBLE_GAP);
    expect(place.top).toBe(100);
    expect(place.tailY).toBe(17);
  });

  it("flips to the left of the box with the tail on its right edge when the right has no room", () => {
    const wide = { ...box, x: 560 };
    const place = bubblePlace(wide, { ...mark, x: 740 }, size, view);

    expect(place.side).toBe("left");
    expect(place.left + size.width + BUBBLE_GAP).toBe(560);
    expect(place.top).toBe(100);
  });

  it("stays right when it fits exactly and flips one pixel later", () => {
    const fit = 800 - BUBBLE_EDGE - size.width - BUBBLE_GAP - box.width;

    expect(bubblePlace({ ...box, x: fit }, mark, size, view).side).toBe(
      "right",
    );
    expect(bubblePlace({ ...box, x: fit + 1 }, mark, size, view).side).toBe(
      "left",
    );
  });

  it("slides up to stay inside the bottom of the view", () => {
    const place = bubblePlace(
      { ...box, y: 580 },
      { ...mark, y: 590 },
      size,
      view,
    );

    expect(place.top + size.height).toBeLessThanOrEqual(600 - BUBBLE_EDGE);
  });

  it("places on the right with no view", () => {
    expect(bubblePlace(box, mark, size).side).toBe("right");
  });
});

describe("bubbleSet", () => {
  const positions = new Map<string, Rect>([
    ["b.py", rect(0, 100)],
    ["a.py", rect(0, 0)],
    ["pkg/", rect(0, 50)],
  ]);

  it("holds only the focused bubble while the toggle is off", () => {
    const set = bubbleSet(
      viewOf("a.py", "b.py"),
      positions,
      { path: "a.py", editing: false },
      false,
    );

    expect(set).toEqual([
      {
        path: "a.py",
        text: "t a.py",
        by: "Ken",
        editing: false,
        focused: true,
      },
    ]);
  });

  it("holds nothing with no focus and the toggle off", () => {
    expect(bubbleSet(viewOf("a.py"), positions, null, false)).toEqual([]);
  });

  it("holds every note on the canvas in canvas order when the toggle is on, read-only and unfocused", () => {
    const set = bubbleSet(
      viewOf("b.py", "pkg/", "a.py"),
      positions,
      null,
      true,
    );

    expect(set.map((one) => one.path)).toEqual(["a.py", "pkg/", "b.py"]);
    expect(set.every((one) => !one.focused && !one.editing)).toBe(true);
  });

  it("leaves out a note whose box is off the canvas", () => {
    const set = bubbleSet(viewOf("a.py", "gone.py"), positions, null, true);

    expect(set.map((one) => one.path)).toEqual(["a.py"]);
  });

  it("lists the focused bubble once, last, and keeps its editing flag", () => {
    const set = bubbleSet(
      viewOf("a.py", "b.py"),
      positions,
      { path: "a.py", editing: true },
      true,
    );

    expect(set.map((one) => [one.path, one.focused, one.editing])).toEqual([
      ["b.py", false, false],
      ["a.py", true, true],
    ]);
  });

  it("gives a focused box with no note an empty bubble ready to write", () => {
    const set = bubbleSet(
      viewOf("a.py"),
      positions,
      { path: "b.py", editing: true },
      false,
    );

    expect(set).toEqual([
      { path: "b.py", text: null, by: null, editing: true, focused: true },
    ]);
  });

  it("holds nothing without a view", () => {
    expect(bubbleSet(null, positions, null, true)).toEqual([]);
  });
});
