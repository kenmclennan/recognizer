import { describe, expect, it } from "vitest";
import { expectedModuleIds } from "./fixtures";
import { ancestorFolders, buildTree, filesOf } from "./tree-model";

describe("buildTree", () => {
  it("holds every python fixture module as a file", () => {
    const ids = expectedModuleIds("python");

    expect(ids).toHaveLength(14);
    expect(filesOf(buildTree(ids))).toHaveLength(14);
  });

  it("holds every typescript fixture module as a file", () => {
    const ids = expectedModuleIds("typescript");

    expect(ids).toHaveLength(15);
    expect(filesOf(buildTree(ids))).toHaveLength(15);
  });

  it("sorts folders before files, each by code unit", () => {
    const root = buildTree(["b.py", "Z/x.py", "a/y.py", "a.py", "a/b/z.py"]);

    expect(root.children.map((child) => `${child.kind}:${child.name}`)).toEqual(
      ["folder:Z", "folder:a", "file:a.py", "file:b.py"],
    );

    const a = root.children[1];

    expect(
      a?.kind === "folder" && a.children.map((child) => child.name),
    ).toEqual(["b", "y.py"]);
  });

  it("does not compact chains of single-child folders", () => {
    const root = buildTree(["a/b/c/d.py"]);
    const a = root.children[0];

    expect(a?.kind === "folder" && a.children[0]?.name).toBe("b");
  });

  it("treats a module directly at the root as a root-level file", () => {
    const root = buildTree(["setup.py", "pkg/a.py"]);

    expect(root.children.map((child) => child.path)).toEqual([
      "pkg",
      "setup.py",
    ]);
  });

  it("lists the ancestor folders of an id from the outermost", () => {
    expect(ancestorFolders("a/b/c.py")).toEqual(["a", "a/b"]);
    expect(ancestorFolders("c.py")).toEqual([]);
  });
});
