import { Neighbours, Repository } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { repositoryFrom } from "./repository-from.js";

const edge = (from: string, to: string, extra: object = {}) => ({
  from,
  to,
  kind: "depends" as const,
  line: 1,
  ...extra,
});

const scan = repositoryFrom({
  modules: [
    { id: "a/x.py", kind: "module" },
    { id: "a/y.py", kind: "module" },
    {
      id: "b/z.py",
      kind: "module",
      members: [
        { name: "Public", exported: true },
        { name: "_hidden", exported: false },
      ],
    },
    { id: "root.py", kind: "module" },
  ],
  edges: [
    edge("a/x.py", "b/z.py", { names: ["Public", "_hidden"] }),
    edge("a/y.py", "b/z.py", { names: ["Public"] }),
    edge("a/x.py", "a/x.py"),
    edge("a/x.py", "elsewhere.py"),
    edge("root.py", "a/y.py", {
      inferred: {
        parameter: "p",
        methods: [],
        class: "C",
        implementations: [],
      },
    }),
  ],
  foreign: [],
});
const modules = Neighbours.moduleNames(scan);

describe("neighbours", () => {
  it("names every module once", () => {
    expect(
      Neighbours.moduleNames(Repository.join([scan, Repository.empty])),
    ).toEqual(modules);
  });

  it("skips self edges and edges to foreign ids", () => {
    expect(
      new Neighbours(scan, modules).usesOf("a/x.py").map((row) => row.id),
    ).toEqual(["b/z.py"]);
  });

  it("marks a row private when any name is not exported", () => {
    const [row] = new Neighbours(scan, modules).usedByOf("b/z.py");

    expect(row).toMatchObject({
      id: "a/x.py",
      names: ["_hidden", "Public"],
      private: true,
    });
    expect(new Neighbours(scan, modules).usedByOf("b/z.py")[1]).toMatchObject({
      id: "a/y.py",
      private: false,
    });
  });

  it("marks a row inferred only when every edge is", () => {
    expect(new Neighbours(scan, modules).usesOf("root.py")[0]?.inferred).toBe(
      true,
    );
    expect(new Neighbours(scan, modules).usesOf("a/x.py")[0]?.inferred).toBe(
      false,
    );
  });

  it("groups by folder with the root folder empty", () => {
    const groups = Neighbours.groupByFolder([
      ...new Neighbours(scan, modules).usedByOf("a/y.py"),
      ...new Neighbours(scan, modules).usedByOf("b/z.py"),
    ]);

    expect(groups.map((group) => group.folder)).toEqual(["", "a"]);
  });

  it("counts a module's and a folder's neighbours", () => {
    const sets = Neighbours.neighbourSets(scan.dependencies, new Set(modules));

    expect(Neighbours.moduleCounts(sets, "b/z.py")).toEqual({
      uses: 0,
      usedBy: 2,
    });
    expect(Neighbours.folderCounts(sets, modules, "a")).toEqual({
      uses: 1,
      usedBy: 1,
    });
  });

  it("lists only the edges crossing a folder's boundary", () => {
    expect(
      new Neighbours(scan, modules).folderUses("a").map((row) => row.id),
    ).toEqual(["b/z.py"]);
    expect(
      new Neighbours(scan, modules).folderUsedBy("a").map((row) => row.id),
    ).toEqual(["root.py"]);
  });
});
