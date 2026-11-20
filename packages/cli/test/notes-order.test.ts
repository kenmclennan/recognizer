import { describe, expect, it } from "vitest";
import {
  appendNote,
  dropIndex,
  moveNote,
  NoteOrderError,
  numberOf,
  placeNote,
  reorderNotes,
} from "../src/notes-order.js";
import type { ViewNote } from "../src/views.js";

const note = (module: string, text = module): ViewNote => ({
  module,
  text,
  by: "Ken",
});
const paths = (notes: ViewNote[]) => notes.map((n) => n.module);
const list = () => [note("a.py"), note("b.py"), note("c.py")];

describe("appendNote", () => {
  it("appends a new path last", () => {
    expect(paths(appendNote(list(), note("d.py")))).toEqual([
      "a.py",
      "b.py",
      "c.py",
      "d.py",
    ]);
  });

  it("replaces a held path in its place", () => {
    const next = appendNote(list(), note("b.py", "new"));

    expect(paths(next)).toEqual(["a.py", "b.py", "c.py"]);
    expect(next[1]?.text).toBe("new");
  });
});

describe("placeNote", () => {
  it("places after a held path", () => {
    expect(paths(placeNote(list(), note("d.py"), { after: "a.py" }))).toEqual([
      "a.py",
      "d.py",
      "b.py",
      "c.py",
    ]);
  });

  it("places first and last", () => {
    expect(paths(placeNote(list(), note("d.py"), "first"))[0]).toBe("d.py");
    expect(paths(placeNote(list(), note("d.py"), "last")).at(-1)).toBe("d.py");
  });

  it("moves a held note", () => {
    expect(paths(placeNote(list(), note("c.py"), "first"))).toEqual([
      "c.py",
      "a.py",
      "b.py",
    ]);
    expect(paths(placeNote(list(), note("a.py"), { after: "c.py" }))).toEqual([
      "b.py",
      "c.py",
      "a.py",
    ]);
  });

  it("throws after itself or after an unheld path", () => {
    expect(() => placeNote(list(), note("a.py"), { after: "a.py" })).toThrow(
      "no note on a.py to place after",
    );
    expect(() => placeNote(list(), note("d.py"), { after: "z.py" })).toThrow(
      NoteOrderError,
    );
  });
});

describe("moveNote", () => {
  it("moves to the start, the end and clamps", () => {
    expect(paths(moveNote(list(), "c.py", 0))).toEqual([
      "c.py",
      "a.py",
      "b.py",
    ]);
    expect(paths(moveNote(list(), "a.py", 2))).toEqual([
      "b.py",
      "c.py",
      "a.py",
    ]);
    expect(paths(moveNote(list(), "a.py", 99))).toEqual([
      "b.py",
      "c.py",
      "a.py",
    ]);
    expect(paths(moveNote(list(), "c.py", -4))).toEqual([
      "c.py",
      "a.py",
      "b.py",
    ]);
  });

  it("leaves the list alone for an unheld path", () => {
    expect(paths(moveNote(list(), "z.py", 0))).toEqual([
      "a.py",
      "b.py",
      "c.py",
    ]);
  });
});

describe("reorderNotes", () => {
  it("returns the notes in the given order", () => {
    expect(paths(reorderNotes(list(), ["c.py", "a.py", "b.py"]))).toEqual([
      "c.py",
      "a.py",
      "b.py",
    ]);
  });

  it("names a missing, an extra and a repeated path together", () => {
    try {
      reorderNotes(list(), ["a.py", "a.py", "x.py", "b.py"]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(NoteOrderError);
      expect((error as NoteOrderError).messages).toEqual([
        "c.py is missing from the order",
        "no note on x.py",
        "a.py is repeated",
      ]);
    }
  });

  it("accepts an empty list for no notes", () => {
    expect(reorderNotes([], [])).toEqual([]);
  });
});

describe("numberOf", () => {
  it("is 1-based or null", () => {
    expect(numberOf(list(), "a.py")).toBe(1);
    expect(numberOf(list(), "c.py")).toBe(3);
    expect(numberOf(list(), "z.py")).toBeNull();
  });
});

describe("dropIndex", () => {
  const midpoints = [10, 30, 50];

  it("finds the insertion index", () => {
    expect(dropIndex(midpoints, 0)).toBe(0);
    expect(dropIndex(midpoints, 20)).toBe(1);
    expect(dropIndex(midpoints, 10)).toBe(0);
    expect(dropIndex(midpoints, 51)).toBe(3);
    expect(dropIndex([], 5)).toBe(0);
  });
});
