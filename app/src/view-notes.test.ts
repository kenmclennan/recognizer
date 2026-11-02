import type { View } from "recognizer";
import { describe, expect, it } from "vitest";
import { noteAt, notedPaths, removeNote, setNote } from "./view-notes";

const base: View = {
  schema_version: 1,
  description: "d",
  commit: null,
  steps: [{ kind: "pick", module: "a.py" }],
};

const withNotes: View = {
  schema_version: 3,
  description: "d",
  commit: null,
  notes: [
    { module: "a.py", text: "A", by: "Ken" },
    { module: "pkg/", text: "P", by: "Claude" },
  ],
  steps: [],
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

describe("setNote", () => {
  it("appends a note at version 3, trimming the text and keeping the steps", () => {
    const next = setNote(base, "a.py", "  Start here ", " Ken ");

    expect(next.schema_version).toBe(3);
    expect(next.notes).toEqual([
      { module: "a.py", text: "Start here", by: "Ken" },
    ]);
    expect(next.steps).toEqual(base.steps);
  });

  it("replaces the text and author of the note on that path and leaves the others", () => {
    const next = setNote(withNotes, "a.py", "New", "Me");

    expect(next.notes).toEqual([
      { module: "a.py", text: "New", by: "Me" },
      { module: "pkg/", text: "P", by: "Claude" },
    ]);
  });

  it("works for a folder path", () => {
    const next = setNote(base, "pkg/", "Folder", "Ken");

    expect(noteAt(next, "pkg/")).toEqual({
      module: "pkg/",
      text: "Folder",
      by: "Ken",
    });
  });

  it("ignores blank text or a blank author", () => {
    expect(setNote(base, "a.py", "  ", "Ken")).toBe(base);
    expect(setNote(base, "a.py", "x", " ")).toBe(base);
  });

  it("migrates a version 2 file, keeping its module notes", () => {
    const next = setNote(version2, "c.py", "C", "Ken");

    expect(next.schema_version).toBe(3);
    expect(next.notes?.map((note) => note.module)).toEqual([
      "a.py",
      "b.py",
      "c.py",
    ]);
  });
});

describe("removeNote", () => {
  it("removes one note and keeps the rest", () => {
    expect(removeNote(withNotes, "a.py").notes).toEqual([
      { module: "pkg/", text: "P", by: "Claude" },
    ]);
  });

  it("drops the notes key at zero", () => {
    const next = removeNote(removeNote(withNotes, "a.py"), "pkg/");

    expect(next).not.toHaveProperty("notes");
  });

  it("leaves the notes unchanged for an unknown path", () => {
    expect(removeNote(withNotes, "zzz.py").notes).toEqual(withNotes.notes);
  });
});

describe("noteAt and notedPaths", () => {
  it("find the note on a path and the set of noted paths", () => {
    expect(noteAt(withNotes, "pkg/")?.text).toBe("P");
    expect(noteAt(withNotes, "b.py")).toBeNull();
    expect(notedPaths(withNotes)).toEqual(new Set(["a.py", "pkg/"]));
    expect(notedPaths(base)).toEqual(new Set());
  });

  it("read the last of several notes on one path", () => {
    const legacy: View = {
      ...withNotes,
      notes: [
        { module: "a.py", text: "first", by: "Ken" },
        { module: "a.py", text: "second", by: "Claude" },
      ],
    };

    expect(noteAt(legacy, "a.py")?.text).toBe("second");
    expect(notedPaths(legacy).size).toBe(1);
  });
});
