import { describe, expect, it } from "vitest";
import type { Disc } from "./health";
import { type FilterState, filterTree, isVisible } from "./tree-filter";
import { buildTree, type FolderNode, filesOf } from "./tree-model";

const IDS = ["a/one.py", "a/two.py", "b/c/three.py", "b/four.py", "root.py"];
const NONE: FilterState = { text: "", onCanvas: false, needsAttention: false };

function context(open: string[] = [], discs: Record<string, Disc> = {}) {
  return {
    isOpen: (id: string) => open.includes(id),
    disc: (id: string): Disc => discs[id] ?? "green",
  };
}

function paths(root: FolderNode): string[] {
  return filesOf(root).map((file) => file.path);
}

function folders(root: FolderNode): string[] {
  return root.children.flatMap((child) =>
    child.kind === "folder" ? [child.path, ...folders(child)] : [],
  );
}

describe("filterTree", () => {
  const root = buildTree(IDS);

  it("leaves the tree alone when nothing is active", () => {
    const filtered = filterTree(root, NONE, context());

    expect(filtered.active).toBe(false);
    expect(filtered.root).toBe(root);
    expect(filtered.fileCount).toBe(5);
  });

  it("keeps matching files and exactly the folders above them", () => {
    const filtered = filterTree(root, { ...NONE, text: "THREE" }, context());

    expect(filtered.active).toBe(true);
    expect(paths(filtered.root)).toEqual(["b/c/three.py"]);
    expect(folders(filtered.root)).toEqual(["b", "b/c"]);
  });

  it("keeps a folder holding one matching and one other file, with only the match", () => {
    const filtered = filterTree(root, { ...NONE, text: "one" }, context());

    expect(paths(filtered.root)).toEqual(["a/one.py"]);
    expect(folders(filtered.root)).toEqual(["a"]);
  });

  it("matches on the path, not just the name", () => {
    const filtered = filterTree(root, { ...NONE, text: "b/c" }, context());

    expect(paths(filtered.root)).toEqual(["b/c/three.py"]);
  });

  it("On canvas keeps only open files", () => {
    const filtered = filterTree(
      root,
      { ...NONE, onCanvas: true },
      context(["a/two.py", "root.py"]),
    );

    expect(paths(filtered.root)).toEqual(["a/two.py", "root.py"]);
    expect(folders(filtered.root)).toEqual(["a"]);
  });

  it("Needs attention keeps amber and red files only", () => {
    const filtered = filterTree(
      root,
      { ...NONE, needsAttention: true },
      context([], {
        "a/one.py": "red",
        "b/four.py": "amber",
        "a/two.py": "grey",
      }),
    );

    expect(paths(filtered.root)).toEqual(["a/one.py", "b/four.py"]);
    expect(folders(filtered.root)).toEqual(["a", "b"]);
  });

  it("combines the three with AND", () => {
    const filtered = filterTree(
      root,
      { text: "a/", onCanvas: true, needsAttention: true },
      context(["a/one.py", "a/two.py", "b/four.py"], {
        "a/one.py": "amber",
        "b/four.py": "red",
      }),
    );

    expect(paths(filtered.root)).toEqual(["a/one.py"]);
  });

  it("reports an empty result when nothing matches", () => {
    const filtered = filterTree(root, { ...NONE, text: "zzz" }, context());

    expect(filtered.fileCount).toBe(0);
    expect(filtered.root.children).toEqual([]);
  });

  it("does not mutate the full tree", () => {
    filterTree(root, { ...NONE, text: "three" }, context());

    expect(paths(root)).toHaveLength(5);
  });

  it("knows whether a file survives the filter", () => {
    const filtered = filterTree(root, { ...NONE, text: "three" }, context());

    expect(isVisible(filtered, "b/c/three.py")).toBe(true);
    expect(isVisible(filtered, "a/one.py")).toBe(false);
  });
});
