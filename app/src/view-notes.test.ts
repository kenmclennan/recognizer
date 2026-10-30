import type { View } from "recognizer";
import { describe, expect, it } from "vitest";
import { addNote, notedModules, removeNoteAt } from "./view-notes";

const base: View = {
  schema_version: 1,
  description: "d",
  commit: null,
  steps: [{ kind: "pick", module: "a.py" }],
};

const version2: View = {
  schema_version: 2,
  description: "d",
  commit: null,
  note: { text: "V", by: "Ken" },
  module_notes: {
    "b.py": { text: "B", by: "Ken" },
    "a.py": { text: "A", by: "Claude" },
  },
  steps: [],
};

describe("view notes", () => {
  it("adds a note at version 3, trimming the text and keeping the steps", () => {
    const next = addNote(base, "a.py", "  Start here ", " Ken ");

    expect(next.schema_version).toBe(3);
    expect(next.notes).toEqual([
      { module: "a.py", text: "Start here", by: "Ken" },
    ]);
    expect(next.steps).toBe(base.steps);
  });

  it("appends a second note on the same module", () => {
    const next = addNote(
      addNote(base, "a.py", "One", "Ken"),
      "a.py",
      "Two",
      "Claude",
    );

    expect(next.notes?.map((note) => note.text)).toEqual(["One", "Two"]);
  });

  it("refuses blank text or a blank author", () => {
    expect(addNote(base, "a.py", "   ", "Ken")).toBe(base);
    expect(addNote(base, "a.py", "x", " ")).toBe(base);
  });

  it("migrates a version 2 view when adding, dropping the view note", () => {
    const next = addNote(version2, "a.py", "New", "Ken");

    expect(next.schema_version).toBe(3);
    expect(next).not.toHaveProperty("note");
    expect(next).not.toHaveProperty("module_notes");
    expect(next.notes?.map((note) => note.text)).toEqual(["A", "B", "New"]);
  });

  it("removes by an index into the notes of any version", () => {
    const next = removeNoteAt(version2, 0);

    expect(next.schema_version).toBe(3);
    expect(next.notes).toEqual([{ module: "b.py", text: "B", by: "Ken" }]);
  });

  it("omits notes once the last is removed and ignores an out-of-range index", () => {
    const one = addNote(base, "a.py", "One", "Ken");

    expect(removeNoteAt(one, 0)).not.toHaveProperty("notes");
    expect(removeNoteAt(one, 5).notes).toHaveLength(1);
  });

  it("lists the modules that carry a note", () => {
    expect(notedModules(version2)).toEqual(new Set(["a.py", "b.py"]));
    expect(notedModules(base)).toEqual(new Set());
  });
});
