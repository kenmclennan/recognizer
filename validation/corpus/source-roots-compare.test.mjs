import { describe, expect, it } from "vitest";
import {
  formatRow,
  formatTable,
  selfPackageNames,
  summarise,
} from "./source-roots-compare.mjs";

function module(id) {
  return { id };
}

function edge(from, to) {
  return { from, to, kind: "depends", line: 1 };
}

const BEFORE = {
  modules: [
    module("src/pkg/__init__.py"),
    module("src/pkg/views.py"),
    module("examples/app.py"),
  ],
  edges: [
    edge("examples/app.py", "foreign:pkg"),
    edge("examples/app.py", "foreign:notmine"),
    edge("src/pkg/views.py", "src/pkg/__init__.py"),
  ],
};

const AFTER = {
  modules: BEFORE.modules,
  edges: [
    edge("examples/app.py", "src/pkg/__init__.py"),
    edge("examples/app.py", "foreign:notmine"),
    edge("src/pkg/views.py", "src/pkg/__init__.py"),
  ],
};

function warning(id, modules) {
  return { id, evidence: { modules } };
}

describe("selfPackageNames", () => {
  it("takes the first segment under a src directory or the repository root", () => {
    expect(
      selfPackageNames({
        modules: [
          module("src/pkg/a.py"),
          module("tools/foo/src/foo/b.py"),
          module("flat/c.py"),
          module("top.py"),
        ],
      }),
    ).toEqual(new Set(["pkg", "foo", "flat", "top"]));
  });
});

describe("summarise", () => {
  it("counts foreign self-edges before and not after", () => {
    const before = summarise(BEFORE, {
      warnings: [warning("orphan", ["src/pkg/views.py"]), warning("hub", ["x"])],
    });
    const after = summarise(AFTER, { warnings: [] });

    expect(before).toMatchObject({
      modules: 3,
      inRepoEdges: 1,
      foreignSelfEdges: 1,
      hubs: 1,
      orphans: 1,
      orphanModules: ["src/pkg/views.py"],
    });
    expect(after).toMatchObject({
      modules: 3,
      inRepoEdges: 2,
      foreignSelfEdges: 0,
      hubs: 0,
      orphans: 0,
    });
  });
});

describe("formatRow and formatTable", () => {
  it("prints one row per repository and run under a header", () => {
    const before = summarise(BEFORE, { warnings: [warning("orphan", ["a"])] });
    const after = summarise(AFTER, { warnings: [] });
    const table = formatTable([
      formatRow("flask", "before", before),
      formatRow("flask", "after", after),
    ]);

    expect(table.split("\n")).toEqual([
      "repository | run | modules | in-repo edges | foreign self-edges | hub | orphan",
      "flask | before | 3 | 1 | 1 | 0 | 1",
      "flask | after | 3 | 2 | 0 | 0 | 0",
    ]);
  });
});
