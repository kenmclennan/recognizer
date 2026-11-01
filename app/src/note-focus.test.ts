import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { View } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  COMPOSER_HEIGHT,
  cardHeight,
  cardNotes,
  firstNote,
  keepsFocus,
  noteRow,
} from "./note-focus";
import { orderNotes } from "./notes-order";

const view = (notes: { module: string; text: string; by: string }[]): View =>
  ({ schema_version: 3, notes, steps: [] }) as unknown as View;

const mixed = view([
  { module: "a.py", text: "one", by: "Ken" },
  { module: "b.py", text: "two", by: "Claude" },
  { module: "a.py", text: "three", by: "Claude" },
]);

describe("keepsFocus", () => {
  const focus = { module: "a.py" };

  it("keeps the focused module", () => {
    expect(keepsFocus({ kind: "module", id: "a.py" }, focus)).toBe(true);
  });

  it("drops another module, a folder, an edge and no selection", () => {
    expect(keepsFocus({ kind: "module", id: "b.py" }, focus)).toBe(false);
    expect(keepsFocus({ kind: "folder", id: "a.py" }, focus)).toBe(false);
    expect(keepsFocus({ kind: "edge", id: "a.py" }, focus)).toBe(false);
    expect(keepsFocus(null, focus)).toBe(false);
  });
});

describe("cardNotes", () => {
  it("is empty for a module without notes", () => {
    expect(cardNotes(mixed, "c.py")).toEqual([]);
  });

  it("returns one note with its whole-list index", () => {
    expect(cardNotes(mixed, "b.py").map((entry) => entry.index)).toEqual([1]);
  });

  it("keeps file order across interleaved modules", () => {
    expect(
      cardNotes(mixed, "a.py").map((entry) => [entry.index, entry.note.text]),
    ).toEqual([
      [0, "one"],
      [2, "three"],
    ]);
  });
});

describe("firstNote", () => {
  it("is the first index or null", () => {
    expect(firstNote(mixed, "a.py")).toBe(0);
    expect(firstNote(mixed, "b.py")).toBe(1);
    expect(firstNote(mixed, "c.py")).toBeNull();
  });
});

describe("noteRow", () => {
  const entry = cardNotes(mixed, "a.py");

  it("tints the app user's note as a person and an agent's as an agent", () => {
    expect(noteRow(entry[0], "Ken", null, false).tint).toBe("person");
    expect(noteRow(entry[1], "Ken", null, false).tint).toBe("agent");
  });

  it("marks only the active index", () => {
    expect(noteRow(entry[1], "Ken", 2, false).active).toBe(true);
    expect(noteRow(entry[0], "Ken", 2, false).active).toBe(false);
  });

  it("carries the off flag and the text", () => {
    expect(noteRow(entry[0], "Ken", null, true)).toMatchObject({
      off: true,
      text: "one",
      by: "Ken",
      module: "a.py",
    });
  });
});

describe("cardHeight", () => {
  it("is the composer alone without notes", () => {
    expect(cardHeight([])).toBe(COMPOSER_HEIGHT);
  });

  it("grows with each note and with wrapped lines", () => {
    const one = cardHeight(cardNotes(mixed, "b.py"));
    const two = cardHeight(cardNotes(mixed, "a.py"));
    const long = cardHeight(
      cardNotes(
        view([{ module: "a.py", text: "word ".repeat(40), by: "Ken" }]),
        "a.py",
      ),
    );

    expect(one).toBeGreaterThan(COMPOSER_HEIGHT);
    expect(two).toBeGreaterThan(one);
    expect(long).toBeGreaterThan(one);
  });
});

describe("the committed version 3 view with notes", () => {
  const path = resolve(
    __dirname,
    "../../schema/view-examples/valid/version-3-with-notes.json",
  );
  const real = JSON.parse(readFileSync(path, "utf8")) as View;

  it("gives the first noted module two entries, Ken then Claude", () => {
    const entries = cardNotes(real, "shop/application/place.py");

    expect(entries.map((entry) => entry.index)).toEqual([0, 1]);
    expect(entries.map((entry) => entry.note.by)).toEqual(["Ken", "Claude"]);
    expect(firstNote(real, "shop/application/place.py")).toBe(0);
  });

  it("orders them into one group and rows tint by author", () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    const order = orderNotes(
      cardNotes(real, "shop/application/place.py").map((e) => e.note),
      new Map([["shop/application/place.py", rect]]),
    );
    const rows = cardNotes(real, "shop/application/place.py").map((entry) =>
      noteRow(entry, "Ken", 1, false),
    );

    expect(order.groups).toHaveLength(1);
    expect(rows.map((row) => row.tint)).toEqual(["person", "agent"]);
    expect(rows.map((row) => row.active)).toEqual([false, true]);
  });
});
