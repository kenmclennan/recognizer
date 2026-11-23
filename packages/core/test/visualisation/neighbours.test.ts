import { describe, expect, it } from "vitest";
import { Neighbours } from "../../src/index.js";
import { repositoryWith } from "./world.js";

const repository = repositoryWith(
  ["root.py", "a/x.py", "a/y.py", "b/z.py", "b/w.py", "lone.py"],
  [
    { from: "root.py", to: "a/x.py", names: ["f"], inferred: true },
    { from: "a/x.py", to: "b/z.py", names: ["priv"] },
    { from: "b/z.py", to: "b/w.py" },
    { from: "a/y.py", to: "b/z.py" },
  ],
  { privateMember: { file: "b/z.py", name: "priv" } },
);

describe("Neighbours", () => {
  const neighbours = new Neighbours(repository);

  it("lists what a file uses and what uses it, flagging a private member", () => {
    expect(neighbours.usesOf("a/x.py")).toEqual([
      { id: "b/z.py", names: ["priv"], private: true, inferred: false },
    ]);
    expect(neighbours.usesOf("root.py")[0]?.inferred).toBe(true);
    expect(neighbours.usedByOf("b/z.py").map((row) => row.id)).toEqual([
      "a/x.py",
      "a/y.py",
    ]);
  });

  it("lists what a folder uses and is used by across its boundary", () => {
    expect(neighbours.folderUses("a").map((row) => row.id)).toEqual(["b/z.py"]);
    expect(neighbours.folderUsedBy("a").map((row) => row.id)).toEqual([
      "root.py",
    ]);
  });

  it("groups a root file under the empty folder", () => {
    const groups = Neighbours.groupByFolder(neighbours.usedByOf("a/x.py"));

    expect(groups.map((group) => group.folder)).toEqual([""]);
  });

  it("finds a path one step away, two steps away, none, and an empty one to itself", () => {
    expect(neighbours.shortestPath("a/x.py", "b/z.py")?.length).toBe(1);
    expect(neighbours.shortestPath("root.py", "b/z.py")?.length).toBe(2);
    expect(neighbours.shortestPath("root.py", "lone.py")).toBeNull();
    expect(neighbours.shortestPath("root.py", "root.py")).toEqual([]);
  });
});
