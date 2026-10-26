import type { Scan } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  boxFigures,
  buildCanvasGraph,
  edgesOf,
  type GraphInput,
  presenceOf,
} from "./canvas-graph";
import { expectedScan } from "./fixtures";

function graphOf(scan: Scan, overrides: Partial<GraphInput> = {}) {
  const modules = scan.modules.map((module) => module.id);

  return buildCanvasGraph({
    scans: [scan],
    modules,
    opened: modules,
    disc: () => "green",
    folded: new Set(),
    focus: null,
    showInferred: true,
    ghosts: new Set(),
    ...overrides,
  });
}

const chain: Scan = {
  modules: [
    { id: "top.py", kind: "module" },
    { id: "lightcycle/application/work/create.py", kind: "module" },
    { id: "lightcycle/application/work/other.py", kind: "module" },
    { id: "lightcycle/ports/store.py", kind: "module" },
    { id: "lightcycle/adapters/sql.py", kind: "module" },
  ],
  edges: [
    {
      from: "lightcycle/application/work/create.py",
      to: "lightcycle/ports/store.py",
      kind: "depends",
      line: 1,
    },
    {
      from: "lightcycle/application/work/other.py",
      to: "lightcycle/ports/store.py",
      kind: "depends",
      line: 2,
    },
    {
      from: "lightcycle/adapters/sql.py",
      to: "lightcycle/ports/store.py",
      kind: "implements",
      line: 3,
      member: "Sql",
      to_member: "Store",
    },
  ],
  foreign: [],
};

describe("frames", () => {
  it("nests one frame per folder, each labelled with its own segment", () => {
    const graph = graphOf(chain, {
      opened: ["lightcycle/application/work/create.py", "top.py"],
    });

    expect(graph.frames.map((frame) => [frame.path, frame.label])).toEqual([
      ["lightcycle", "lightcycle"],
      ["lightcycle/application", "application"],
      ["lightcycle/application/work", "work"],
    ]);
    expect(graph.frames.map((frame) => frame.parent)).toEqual([
      null,
      "lightcycle",
      "lightcycle/application",
    ]);
    expect(graph.frames.every((frame) => !frame.label.includes("/"))).toBe(
      true,
    );
    expect(graph.boxes.find((box) => box.id === "top.py")?.parent).toBeNull();
  });

  it("counts open and held files recursively", () => {
    const graph = graphOf(chain, {
      opened: ["lightcycle/application/work/create.py"],
    });
    const frame = (path: string) =>
      graph.frames.find((candidate) => candidate.path === path);

    expect(frame("lightcycle")).toMatchObject({ open: 1, held: 4 });
    expect(frame("lightcycle/application")).toMatchObject({ open: 1, held: 2 });
  });

  it("makes the focused folder the outermost frame and drops outsiders", () => {
    const graph = graphOf(chain, {
      focus: "lightcycle/application",
    });

    expect(graph.frames.map((frame) => frame.path)).toEqual([
      "lightcycle/application",
      "lightcycle/application/work",
    ]);
    expect(graph.frames[0]?.parent).toBeNull();
    expect(graph.boxes).toHaveLength(2);
  });
});

describe("folding", () => {
  it("draws a folded folder as one box named for it", () => {
    const graph = graphOf(chain, {
      folded: new Set(["lightcycle/application"]),
    });
    const folded = graph.boxes.find((box) => box.kind === "folder");

    expect(folded).toMatchObject({
      id: "lightcycle/application",
      label: "application",
      open: 2,
      held: 2,
      parent: "lightcycle",
    });
    expect(boxFigures(folded as NonNullable<typeof folded>)).toBe("2 of 2");
    expect(
      graph.frames.some((frame) =>
        frame.path.startsWith("lightcycle/application"),
      ),
    ).toBe(false);
  });

  it("joins edges between the same two boxes into one counted line", () => {
    const graph = graphOf(chain, {
      folded: new Set(["lightcycle/application"]),
    });
    const line = graph.lines.find((candidate) => candidate.style === "plain");

    expect(line).toMatchObject({
      from: "lightcycle/application",
      to: "lightcycle/ports/store.py",
      count: 2,
    });
  });

  it("prefers the outermost folded ancestor", () => {
    const graph = graphOf(chain, {
      folded: new Set(["lightcycle/application/work", "lightcycle"]),
    });

    expect(graph.boxes.map((box) => box.id)).toEqual(["top.py", "lightcycle"]);
  });
});

describe("figures", () => {
  const scan: Scan = {
    modules: ["a.py", "b.py", "c.py", "d.py"].map((id) => ({
      id,
      kind: "module" as const,
    })),
    edges: [
      { from: "a.py", to: "b.py", kind: "depends", line: 1 },
      { from: "a.py", to: "c.py", kind: "depends", line: 2 },
      { from: "d.py", to: "a.py", kind: "depends", line: 3 },
    ],
    foreign: [],
  };

  it("shows how many neighbours are off the canvas, split by direction", () => {
    const graph = graphOf(scan, { opened: ["a.py", "b.py"] });
    const a = graph.boxes.find((box) => box.id === "a.py");

    expect(a).toMatchObject({ missingUses: 1, missingUsedBy: 1 });
    expect(boxFigures(a as NonNullable<typeof a>)).toBe("↑1 ↓1");
  });

  it("gives the full counts for the bar and not the missing ones", () => {
    const graph = graphOf(scan, { opened: ["a.py"] });

    expect(graph.counts({ kind: "module", id: "a.py" })).toEqual({
      uses: 2,
      usedBy: 1,
    });
  });

  it("counts a folder by the modules outside it that it reaches", () => {
    const graph = graphOf(chain);

    expect(
      graph.counts({ kind: "folder", id: "lightcycle/application" }),
    ).toEqual({
      uses: 1,
      usedBy: 0,
    });
  });
});

describe("edge styles", () => {
  const scan: Scan = {
    modules: [
      { id: "a.py", kind: "module" },
      {
        id: "b.py",
        kind: "module",
        members: [
          { name: "hidden", exported: false },
          { name: "shown", exported: true },
        ],
      },
      { id: "c.py", kind: "module" },
    ],
    edges: [
      { from: "a.py", to: "b.py", kind: "depends", line: 1, names: ["shown"] },
      { from: "a.py", to: "b.py", kind: "depends", line: 2, names: ["hidden"] },
      {
        from: "a.py",
        to: "b.py",
        kind: "depends",
        line: 3,
        names: ["hidden"],
        inferred: {
          parameter: "p",
          methods: ["m"],
          class: "B",
          implementations: [],
        },
      },
      { from: "a.py", to: "c.py", kind: "depends", line: 4, names: ["hidden"] },
      {
        from: "c.py",
        to: "b.py",
        kind: "inherits",
        line: 5,
        member: "C",
        to_member: "B",
      },
    ],
    foreign: [],
  };

  it("derives plain, private, inferred and hollow, inferred beating private", () => {
    const graph = graphOf(scan);

    expect(
      graph.lines.map((line) => `${line.from}>${line.to}:${line.style}`).sort(),
    ).toEqual([
      "a.py>b.py:inferred",
      "a.py>b.py:plain",
      "a.py>b.py:private",
      "a.py>c.py:plain",
      "c.py>b.py:hollow",
    ]);
  });

  it("never reads a missing members list as private", () => {
    const graph = graphOf(scan);

    expect(graph.lines.find((line) => line.to === "c.py")?.style).toBe("plain");
  });

  it("drops inferred lines when switched off without moving the counts", () => {
    const on = graphOf(scan);
    const off = graphOf(scan, { showInferred: false });

    expect(off.lines.some((line) => line.style === "inferred")).toBe(false);
    expect(off.counts({ kind: "module", id: "a.py" })).toEqual(
      on.counts({ kind: "module", id: "a.py" }),
    );
  });
});

describe("the python fixture", () => {
  const scan = expectedScan("python");

  it("draws 14 boxes, 5 frames and 15 lines in the expected styles", () => {
    const graph = graphOf(scan);
    const styles = (style: string) =>
      graph.lines.filter((line) => line.style === style);

    expect(graph.boxes).toHaveLength(14);
    expect(graph.frames.map((frame) => frame.path)).toEqual([
      "shop",
      "shop/adapters",
      "shop/application",
      "shop/domain",
      "shop/ports",
    ]);
    expect(graph.frames.every((frame) => !frame.label.includes("/"))).toBe(
      true,
    );
    expect(graph.lines).toHaveLength(15);
    expect(
      styles("private")
        .map((line) => `${line.from}>${line.to}`)
        .sort(),
    ).toEqual([
      "shop/application/place.py>shop/domain/order.py",
      "shop/domain/__init__.py>shop/domain/order.py",
    ]);
    expect(styles("inferred").map((line) => line.from)).toEqual([
      "shop/application/refund.py",
    ]);
    expect(styles("hollow")).toHaveLength(2);
  });

  it("folds shop/domain into 11 lines, one of them counted twice", () => {
    const graph = graphOf(scan, { folded: new Set(["shop/domain"]) });
    const counted = graph.lines.filter((line) => line.count > 1);

    expect(graph.lines).toHaveLength(11);
    expect(counted).toHaveLength(1);
    expect(counted[0]).toMatchObject({
      from: "shop/application/report.py",
      to: "shop/domain",
      count: 2,
      style: "plain",
    });
  });
});

describe("the typescript fixture", () => {
  it("draws 15 boxes, 5 frames and 19 lines with no private import", () => {
    const graph = graphOf(expectedScan("typescript"));

    expect(graph.boxes).toHaveLength(15);
    expect(graph.frames.map((frame) => frame.path)).toEqual([
      "api",
      "web",
      "api/src",
      "web/src",
      "api/src/models",
    ]);
    expect(graph.lines).toHaveLength(19);
    expect(graph.lines.some((line) => line.style === "private")).toBe(false);
  });
});

describe("selection helpers", () => {
  it("highlights the lines touching a module, a folder or one edge", () => {
    const graph = graphOf(chain);
    const store = "lightcycle/ports/store.py";

    expect(edgesOf(graph, null)).toBeNull();
    expect(edgesOf(graph, { kind: "module", id: store })?.size).toBe(3);
    expect(
      edgesOf(graph, { kind: "folder", id: "lightcycle/adapters" })?.size,
    ).toBe(1);

    const only = graph.lines[0]?.id as string;

    expect([...(edgesOf(graph, { kind: "edge", id: only }) ?? [])]).toEqual([
      only,
    ]);
  });

  it("reports what is on the canvas", () => {
    const present = presenceOf(
      graphOf(chain, { folded: new Set(["lightcycle/application"]) }),
    );

    expect(present.folder("lightcycle/application")).toBe(true);
    expect(present.folder("lightcycle")).toBe(true);
    expect(present.module("top.py")).toBe(true);
    expect(present.module("lightcycle/application/work/create.py")).toBe(false);
  });
});

describe("ghosts", () => {
  const create = "lightcycle/application/work/create.py";
  const other = "lightcycle/application/work/other.py";
  const store = "lightcycle/ports/store.py";
  const sql = "lightcycle/adapters/sql.py";

  it("draws a ghost box in its folder frame with dashed lines to real modules", () => {
    const graph = graphOf(chain, {
      opened: [store],
      ghosts: new Set([create, sql]),
    });
    const ghosts = graph.boxes.filter((box) => box.ghost);

    expect(ghosts.map((box) => box.id).sort()).toEqual([sql, create]);
    expect(ghosts[0]).toMatchObject({
      kind: "module",
      missingUses: 0,
      missingUsedBy: 0,
    });
    expect(graph.boxes.find((box) => box.id === store)?.ghost).toBe(false);
    expect(graph.lines.map((line) => [line.from, line.ghost]).sort()).toEqual([
      [sql, true],
      [create, true],
    ]);
    expect(graph.frames.map((frame) => frame.path)).toContain(
      "lightcycle/application/work",
    );
    expect(
      graph.frames.find(
        (frame) => frame.path === "lightcycle/application/work",
      ),
    ).toMatchObject({ open: 0 });
  });

  it("draws an edge between two ghosts and leaves real edges real", () => {
    const graph = graphOf(chain, {
      opened: [create, store],
      ghosts: new Set([other]),
    });

    expect(
      graph.lines.map((line) => [line.from, line.to, line.ghost]).sort(),
    ).toEqual([
      [create, store, false],
      [other, store, true],
    ]);
  });

  it("draws nothing for a ghost that is open, unknown, outside the focus or in a folded folder", () => {
    const graph = graphOf(chain, {
      opened: [create, store],
      ghosts: new Set([create, "missing.py", "top.py"]),
      focus: "lightcycle",
    });

    expect(graph.boxes.filter((box) => box.ghost)).toEqual([]);

    const folded = graphOf(chain, {
      opened: [store],
      ghosts: new Set([create]),
      folded: new Set(["lightcycle/application"]),
    });

    expect(folded.boxes.filter((box) => box.ghost)).toEqual([]);
  });

  it("honours the show inferred switch for ghost lines", () => {
    const scan: Scan = {
      modules: [
        { id: "a.py", kind: "module" },
        { id: "b.py", kind: "module" },
      ],
      edges: [
        {
          from: "a.py",
          to: "b.py",
          kind: "depends",
          line: 1,
          inferred: {
            parameter: "p",
            methods: ["m"],
            class: "B",
            implementations: [],
          },
        },
      ],
      foreign: [],
    } as unknown as Scan;
    const input = { opened: ["b.py"], ghosts: new Set(["a.py"]) };

    expect(graphOf(scan, { ...input, showInferred: true }).lines).toHaveLength(
      1,
    );
    expect(graphOf(scan, { ...input, showInferred: false }).lines).toHaveLength(
      0,
    );
  });

  it("leaves the real boxes' missing counts and the bar counts unchanged", () => {
    const plain = graphOf(chain, { opened: [store] });
    const ghosted = graphOf(chain, {
      opened: [store],
      ghosts: new Set([create, other, sql]),
    });
    const real = (graph: typeof plain) =>
      graph.boxes.find((box) => box.id === store);

    expect(real(ghosted)).toEqual(real(plain));
    expect(ghosted.counts({ kind: "module", id: store })).toEqual(
      plain.counts({ kind: "module", id: store }),
    );
  });

  it("never lets a ghost satisfy a selection or join the highlight", () => {
    const graph = graphOf(chain, {
      opened: [store],
      ghosts: new Set([create]),
    });

    expect(presenceOf(graph).module(create)).toBe(false);
    expect(presenceOf(graph).module(store)).toBe(true);
    expect(presenceOf(graph).folder("lightcycle/application/work")).toBe(false);
    expect(presenceOf(graph).folder("lightcycle/ports")).toBe(true);
    expect(edgesOf(graph, { kind: "module", id: store })).toEqual(new Set());
  });
});
