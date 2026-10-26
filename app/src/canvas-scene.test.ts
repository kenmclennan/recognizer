import { describe, expect, it } from "vitest";
import type { CanvasGraph } from "./canvas-graph";
import type { Layout } from "./canvas-layout";
import { arrowhead, DRAW_ORDER, GHOST_DASH, toScene } from "./canvas-scene";

const graph = {
  frames: [
    { path: "f", label: "f", parent: null, disc: "green", open: 2, held: 3 },
  ],
  boxes: [
    {
      id: "f/a.py",
      kind: "module",
      label: "a",
      parent: "f",
      disc: "green",
      open: 1,
      held: 1,
      missingUses: 2,
      missingUsedBy: 0,
    },
    {
      id: "f/b.py",
      kind: "module",
      label: "b",
      parent: "f",
      disc: "red",
      open: 1,
      held: 1,
      missingUses: 0,
      missingUsedBy: 0,
    },
  ],
  lines: [
    {
      id: "one",
      from: "f/a.py",
      to: "f/b.py",
      style: "plain",
      count: 1,
      edges: [],
    },
    {
      id: "two",
      from: "f/a.py",
      to: "f/b.py",
      style: "inferred",
      count: 3,
      edges: [],
    },
    {
      id: "three",
      from: "f/a.py",
      to: "f/b.py",
      style: "hollow",
      count: 1,
      edges: [],
    },
    {
      id: "four",
      from: "f/a.py",
      to: "f/b.py",
      style: "private",
      count: 1,
      edges: [],
    },
  ],
} as unknown as CanvasGraph;

const line = [
  { x: 10, y: 10 },
  { x: 10, y: 60 },
];

const layout: Layout = {
  frames: new Map([["f", { x: 0, y: 0, width: 200, height: 150 }]]),
  boxes: new Map([
    ["f/a.py", { x: 10, y: 30, width: 100, height: 36 }],
    ["f/b.py", { x: 10, y: 100, width: 100, height: 36 }],
  ]),
  lines: new Map(["one", "two", "three", "four"].map((id) => [id, line])),
};

describe("scene", () => {
  const scene = toScene(graph, layout);

  it("draws frames, then lines, then boxes", () => {
    expect(scene.drawOrder).toEqual(["frames", "lines", "boxes"]);
    expect(DRAW_ORDER).toBe(scene.drawOrder);
  });

  it("dashes by style and hollows only the hollow arrowhead", () => {
    const dash = (id: string) => scene.lines.find((l) => l.id === id)?.dash;
    const hollow = (id: string) =>
      scene.arrows.find((a) => a.lineId === id)?.hollow;

    expect(dash("one")).toBeNull();
    expect(dash("three")).toBeNull();
    expect(dash("four")).toMatch(/\d/);
    expect(dash("two")).toMatch(/\d/);
    expect(dash("four")).not.toBe(dash("two"));
    expect(hollow("three")).toBe(true);
    expect(hollow("one")).toBe(false);
  });

  it("labels a count only above one", () => {
    expect(scene.lines.find((l) => l.id === "one")?.countAt).toBeNull();
    expect(scene.lines.find((l) => l.id === "two")?.countAt).toEqual({
      x: 10,
      y: 35,
    });
  });

  it("orients the arrowhead on the last segment", () => {
    const down = arrowhead([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
    ]);
    const right = arrowhead([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ]);

    expect(down[0]).toEqual({ x: 0, y: 50 });
    expect(down[1]?.y).toBeLessThan(50);
    expect(down[1]?.y).toBe(down[2]?.y);
    expect(down[1]?.x).toBe(-(down[2]?.x as number));
    expect(right[0]).toEqual({ x: 50, y: 0 });
    expect(right[1]?.x).toBeLessThan(50);
    expect(right[1]?.x).toBe(right[2]?.x);
  });

  it("bounds every shape", () => {
    expect(scene.bounds).toEqual({ x: 0, y: 0, width: 200, height: 150 });
  });

  it("carries the figures on boxes and frames", () => {
    expect(scene.boxes[0]?.figures).toBe("↑2");
    expect(scene.frames[0]?.figure).toBe("2 of 3");
  });
});

describe("ghost scene", () => {
  const ghostGraph = {
    frames: [
      { path: "f", label: "f", parent: null, disc: "green", open: 1, held: 3 },
    ],
    boxes: [
      {
        id: "f/a.py",
        kind: "module",
        label: "a",
        parent: "f",
        disc: "green",
        open: 1,
        held: 1,
        missingUses: 0,
        missingUsedBy: 0,
        ghost: false,
      },
      {
        id: "f/g.py",
        kind: "module",
        label: "g",
        parent: "f",
        disc: "green",
        open: 1,
        held: 1,
        missingUses: 0,
        missingUsedBy: 0,
        ghost: true,
      },
    ],
    lines: [
      {
        id: "real",
        from: "f/a.py",
        to: "f/a.py",
        style: "private",
        count: 1,
        edges: [],
        ghost: false,
      },
      {
        id: "ghost",
        from: "f/a.py",
        to: "f/g.py",
        style: "hollow",
        count: 1,
        edges: [],
        ghost: true,
      },
    ],
  } as unknown as CanvasGraph;

  const ghostLayout: Layout = {
    frames: new Map([["f", { x: 0, y: 0, width: 200, height: 150 }]]),
    boxes: new Map([
      ["f/a.py", { x: 10, y: 30, width: 100, height: 36 }],
      ["f/g.py", { x: 10, y: 300, width: 100, height: 36 }],
    ]),
    lines: new Map([
      ["real", line],
      ["ghost", line],
    ]),
  };

  const scene = toScene(ghostGraph, ghostLayout);

  it("carries ghost onto boxes and lines", () => {
    expect(scene.boxes.map((box) => box.ghost)).toEqual([false, true]);
    expect(scene.lines.map((l) => l.ghost)).toEqual([false, true]);
  });

  it("dashes a ghost line with the fixed ghost dash and keeps a hollow arrowhead", () => {
    const ghost = scene.lines.find((l) => l.id === "ghost");

    expect(ghost?.dash).toBe(GHOST_DASH);
    expect(scene.lines.find((l) => l.id === "real")?.dash).not.toBe(GHOST_DASH);
    expect(scene.arrows.find((a) => a.lineId === "ghost")?.hollow).toBe(true);
  });

  it("includes ghosts in the bounds", () => {
    expect(scene.bounds.y + scene.bounds.height).toBeGreaterThanOrEqual(336);
  });
});
