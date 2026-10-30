import type { View } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  notedModules,
  removeModuleNote,
  removeViewNote,
  setModuleNote,
  setViewNote,
} from "./view-notes";

const base: View = {
  schema_version: 1,
  description: "d",
  commit: null,
  steps: [{ kind: "pick", module: "a.py" }],
};

describe("view notes", () => {
  it("sets a view note at version 2, trimming the text", () => {
    const next = setViewNote(base, "  Start here ", "Ken");

    expect(next.schema_version).toBe(2);
    expect(next.note).toEqual({ text: "Start here", by: "Ken" });
    expect(next.steps).toBe(base.steps);
  });

  it("replaces a view note and removes it", () => {
    const first = setViewNote(base, "One", "Ken");
    const second = setViewNote(first, "Two", "Claude");

    expect(second.note).toEqual({ text: "Two", by: "Claude" });
    expect("note" in removeViewNote(second)).toBe(false);
  });

  it("refuses blank text or a blank author", () => {
    expect(setViewNote(base, "   ", "Ken")).toBe(base);
    expect(setViewNote(base, "x", " ")).toBe(base);
    expect(setModuleNote(base, "a.py", " ", "Ken")).toBe(base);
  });

  it("sets, replaces and removes a module note, dropping an empty map", () => {
    const first = setModuleNote(base, "a.py", "One", "Ken");
    const second = setModuleNote(first, "a.py", "Two", "Claude");

    expect(second.schema_version).toBe(2);
    expect(second.module_notes).toEqual({
      "a.py": { text: "Two", by: "Claude" },
    });

    const removed = removeModuleNote(second, "a.py");

    expect("module_notes" in removed).toBe(false);
  });

  it("keeps the other notes when one is removed", () => {
    const both = setModuleNote(
      setModuleNote(setViewNote(base, "V", "Ken"), "a.py", "A", "Ken"),
      "b.py",
      "B",
      "Ken",
    );
    const removed = removeModuleNote(both, "a.py");

    expect(Object.keys(removed.module_notes ?? {})).toEqual(["b.py"]);
    expect(removed.note).toEqual({ text: "V", by: "Ken" });
  });

  it("lists the modules that have a note", () => {
    expect(notedModules(base).size).toBe(0);
    expect(notedModules(setModuleNote(base, "a.py", "A", "Ken"))).toEqual(
      new Set(["a.py"]),
    );
  });
});
