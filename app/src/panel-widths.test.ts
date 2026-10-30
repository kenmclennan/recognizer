import { describe, expect, it } from "vitest";
import {
  clampWidth,
  dragWidth,
  loadWidths,
  PANEL_LIMITS,
  PANEL_WIDTHS_KEY,
  saveWidths,
} from "./panel-widths";

const storeOf = (text: string | null) => ({ getItem: () => text });

describe("clampWidth", () => {
  it("holds the bounds themselves", () => {
    expect(clampWidth("tree", 200)).toBe(200);
    expect(clampWidth("tree", 480)).toBe(480);
    expect(clampWidth("inspector", 280)).toBe(280);
    expect(clampWidth("inspector", 640)).toBe(640);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(clampWidth("tree", 10)).toBe(200);
    expect(clampWidth("tree", 9000)).toBe(480);
    expect(clampWidth("inspector", 10)).toBe(280);
    expect(clampWidth("inspector", 9000)).toBe(640);
  });

  it("rounds to an integer", () => {
    expect(clampWidth("tree", 300.6)).toBe(301);
  });

  it("gives the initial width for a value that is not a finite number", () => {
    expect(clampWidth("tree", Number.NaN)).toBe(PANEL_LIMITS.tree.initial);
    expect(clampWidth("inspector", Number.POSITIVE_INFINITY)).toBe(
      PANEL_LIMITS.inspector.initial,
    );
  });
});

describe("loadWidths", () => {
  const initial = { tree: 280, inspector: 340 };

  it("gives both initial widths for an empty store", () => {
    expect(loadWidths(storeOf(null))).toEqual(initial);
  });

  it("reads a valid pair", () => {
    expect(
      loadWidths(storeOf(JSON.stringify({ tree: 300, inspector: 400 }))),
    ).toEqual({ tree: 300, inspector: 400 });
  });

  it("clamps out-of-range values", () => {
    expect(
      loadWidths(storeOf(JSON.stringify({ tree: 5, inspector: 5000 }))),
    ).toEqual({ tree: 200, inspector: 640 });
  });

  it("gives both initial widths for malformed JSON", () => {
    expect(loadWidths(storeOf("{nope"))).toEqual(initial);
  });

  it("gives both initial widths for a non-object", () => {
    expect(loadWidths(storeOf("42"))).toEqual(initial);
    expect(loadWidths(storeOf("null"))).toEqual(initial);
  });

  it("gives both initial widths when the read throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
    };

    expect(loadWidths(throwing)).toEqual(initial);
  });

  it("keeps the valid field when the other is not a number", () => {
    expect(
      loadWidths(storeOf(JSON.stringify({ tree: 333, inspector: "wide" }))),
    ).toEqual({ tree: 333, inspector: 340 });
  });
});

describe("saveWidths", () => {
  it("writes JSON that loadWidths round-trips", () => {
    const written = new Map<string, string>();
    const widths = { tree: 310, inspector: 450 };

    saveWidths({ setItem: (key, value) => written.set(key, value) }, widths);

    expect(written.has(PANEL_WIDTHS_KEY)).toBe(true);
    expect(loadWidths({ getItem: (key) => written.get(key) ?? null })).toEqual(
      widths,
    );
  });

  it("does not throw when the write throws", () => {
    const throwing = {
      setItem: () => {
        throw new Error("full");
      },
    };

    expect(() =>
      saveWidths(throwing, { tree: 300, inspector: 400 }),
    ).not.toThrow();
  });
});

describe("dragWidth", () => {
  it("grows the tree with the pointer moving right", () => {
    expect(dragWidth("tree", 280, 100, 150)).toBe(330);
  });

  it("grows the inspector with the pointer moving left", () => {
    expect(dragWidth("inspector", 340, 500, 450)).toBe(390);
  });

  it("clamps at both limits", () => {
    expect(dragWidth("tree", 280, 0, 5000)).toBe(480);
    expect(dragWidth("tree", 280, 0, -5000)).toBe(200);
    expect(dragWidth("inspector", 340, 0, -5000)).toBe(640);
    expect(dragWidth("inspector", 340, 0, 5000)).toBe(280);
  });
});

describe("dragWidth across several panels", () => {
  it("moves the shared width by the drag distance divided by the shown panels", () => {
    expect(dragWidth("inspector", 340, 500, 440, 3)).toBe(360);
  });

  it("treats a missing or zero count as one panel", () => {
    expect(dragWidth("inspector", 340, 500, 440)).toBe(400);
    expect(dragWidth("inspector", 340, 500, 440, 0)).toBe(400);
  });
});
