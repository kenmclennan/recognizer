import { describe, expect, it } from "vitest";
import { expectedModuleIds } from "./fixtures";
import { compactFolders } from "./folder-compaction";

const kotlin = [
  "core/data/src/main/kotlin/com/example/A.kt",
  "core/data/src/main/kotlin/com/example/B.kt",
  "core/api/Api.kt",
  "core/api/x/y/Z.kt",
];

describe("compactFolders", () => {
  it("compacts a chain of empty single-child folders into its deepest folder", () => {
    const compaction = compactFolders(kotlin);

    expect([...compaction.folders].sort()).toEqual([
      "core",
      "core/api",
      "core/api/x/y",
      "core/data/src/main/kotlin/com/example",
    ]);
    expect(compaction.label("core/data/src/main/kotlin/com/example")).toBe(
      "data/src/main/kotlin/com/example",
    );
    expect(compaction.label("core/api/x/y")).toBe("x/y");
    expect(compaction.label("core")).toBe("core");
  });

  it("ends a chain at a folder holding a module", () => {
    const compaction = compactFolders(["a/b/m.py"]);

    expect([...compaction.folders]).toEqual(["a/b"]);
    expect(compaction.label("a/b")).toBe("a/b");
  });

  it("ends a chain at a folder with two subfolders", () => {
    const compaction = compactFolders(["a/b/m.py", "a/c/n.py"]);

    expect([...compaction.folders].sort()).toEqual(["a", "a/b", "a/c"]);
  });

  it("never merges the root", () => {
    const compaction = compactFolders(["src/m.py"]);

    expect([...compaction.folders]).toEqual(["src"]);
    expect(compaction.parent("src")).toBeNull();
    expect(compaction.label("src")).toBe("src");
  });

  it("maps an inner folder to its compacted folder and leaves others unchanged", () => {
    const compaction = compactFolders(kotlin);

    expect(compaction.canonical("core/data/src")).toBe(
      "core/data/src/main/kotlin/com/example",
    );
    expect(compaction.canonical("core")).toBe("core");
    expect(compaction.canonical("nowhere/else")).toBe("nowhere/else");
    expect(compaction.canonical("")).toBe("");
  });

  it("lists compacted ancestors only, outermost first", () => {
    const compaction = compactFolders(kotlin);

    expect(
      compaction.ancestors("core/data/src/main/kotlin/com/example/A.kt"),
    ).toEqual(["core", "core/data/src/main/kotlin/com/example"]);
    expect(compaction.ancestors("core/api/x/y/Z.kt")).toEqual([
      "core",
      "core/api",
      "core/api/x/y",
    ]);
    expect(compaction.parent("core/api/x/y")).toBe("core/api");
  });

  it("recomputes after a rescan adds a file in the middle of a chain", () => {
    const rescanned = compactFolders([
      ...kotlin,
      "core/data/src/main/Extra.kt",
    ]);

    expect(rescanned.folders.has("core/data/src/main")).toBe(true);
    expect(rescanned.label("core/data/src/main")).toBe("data/src/main");
    expect(rescanned.label("core/data/src/main/kotlin/com/example")).toBe(
      "kotlin/com/example",
    );
    expect(rescanned.canonical("core/data/src/main/kotlin")).toBe(
      "core/data/src/main/kotlin/com/example",
    );
    expect(rescanned.canonical("core/data/src")).toBe("core/data/src/main");
  });

  it("compacts the module ids of the typescript fixture scan", () => {
    const ids = expectedModuleIds("typescript");
    const compaction = compactFolders(ids);

    expect(compaction.folders.size).toBeGreaterThan(0);
    expect(compaction.folders.size).toBeLessThanOrEqual(
      new Set(ids.map((id) => id.slice(0, id.lastIndexOf("/")))).size,
    );
  });
});
