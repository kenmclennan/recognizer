import { describe, expect, it } from "vitest";
import {
  folderCounts,
  folderUsedBy,
  folderUses,
  groupByFolder,
  moduleCounts,
  moduleNames,
  neighbourSets,
  type Scan,
  usedByOf,
  usesOf,
} from "../src/index.js";

const edge = (from: string, to: string, extra: object = {}) => ({
  from,
  to,
  kind: "depends" as const,
  line: 1,
  ...extra,
});

const scan: Scan = {
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
};
const modules = moduleNames([scan]);

describe("neighbours", () => {
  it("names every module once", () => {
    expect(moduleNames([scan, scan])).toEqual(modules);
  });

  it("skips self edges and edges to foreign ids", () => {
    expect(usesOf([scan], modules, "a/x.py").map((row) => row.id)).toEqual([
      "b/z.py",
    ]);
  });

  it("marks a row private when any name is not exported", () => {
    const [row] = usedByOf([scan], modules, "b/z.py");

    expect(row).toMatchObject({
      id: "a/x.py",
      names: ["_hidden", "Public"],
      private: true,
    });
    expect(usedByOf([scan], modules, "b/z.py")[1]).toMatchObject({
      id: "a/y.py",
      private: false,
    });
  });

  it("marks a row inferred only when every edge is", () => {
    expect(usesOf([scan], modules, "root.py")[0]?.inferred).toBe(true);
    expect(usesOf([scan], modules, "a/x.py")[0]?.inferred).toBe(false);
  });

  it("groups by folder with the root folder empty", () => {
    const groups = groupByFolder([
      ...usedByOf([scan], modules, "a/y.py"),
      ...usedByOf([scan], modules, "b/z.py"),
    ]);

    expect(groups.map((group) => group.folder)).toEqual(["", "a"]);
  });

  it("counts a module's and a folder's neighbours", () => {
    const sets = neighbourSets(scan.edges, new Set(modules));

    expect(moduleCounts(sets, "b/z.py")).toEqual({ uses: 0, usedBy: 2 });
    expect(folderCounts(sets, modules, "a")).toEqual({ uses: 1, usedBy: 1 });
  });

  it("lists only the edges crossing a folder's boundary", () => {
    expect(folderUses([scan], modules, "a").map((row) => row.id)).toEqual([
      "b/z.py",
    ]);
    expect(folderUsedBy([scan], modules, "a").map((row) => row.id)).toEqual([
      "root.py",
    ]);
  });
});
