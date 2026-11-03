import ELK from "elkjs/lib/elk.bundled.js";
import type { Scan } from "recognizer";
import { describe, expect, it } from "vitest";
import { buildCanvasGraph, type GraphInput } from "./canvas-graph";
import {
  absoluteLayout,
  BOX_HEIGHT,
  BOX_MIN_WIDTH,
  boxWidth,
  FOLDER_BOX_HEIGHT,
  FRAME_PAD,
  FRAME_TOP,
  frameLabelWidth,
  type Layout,
  NOTE_MARK_INSET,
  NOTE_MARK_SIZE,
  toElk,
} from "./canvas-layout";
import { BAR_BOTTOM_PAD, BAR_MIN_BOX_WIDTH, BAR_ROW } from "./metric-bars";

const elk = new ELK();
const measure = (text: string) => text.length * 7;

function scanOf(ids: string[], edges: [string, string][]): Scan {
  return {
    modules: ids.map((id) => ({ id, kind: "module" as const })),
    edges: edges.map(([from, to], index) => ({
      from,
      to,
      kind: "depends" as const,
      line: index + 1,
    })),
    foreign: [],
  };
}

async function layoutOf(
  scan: Scan,
  overrides: Partial<GraphInput> = {},
  fixedMeasure = measure,
  noted: ReadonlySet<string> = new Set(),
) {
  const modules = scan.modules.map((module) => module.id);
  const graph = buildCanvasGraph({
    scans: [scan],
    modules,
    opened: modules,
    disc: () => "green",
    folded: new Set(),
    focus: null,
    showInferred: true,
    ...overrides,
  });
  const result = await elk.layout(toElk(graph, fixedMeasure, noted));

  return { graph, layout: absoluteLayout(result) };
}

function inside(
  inner: Layout["boxes"] extends Map<string, infer R> ? R : never,
  outer: typeof inner,
) {
  return (
    inner.x > outer.x &&
    inner.y > outer.y &&
    inner.x + inner.width < outer.x + outer.width &&
    inner.y + inner.height < outer.y + outer.height
  );
}

describe("frame sizing", () => {
  it("is exactly the box plus padding for a short label", async () => {
    const { graph, layout } = await layoutOf(scanOf(["f/a.py"], []));
    const box = layout.boxes.get("f/a.py");
    const frame = layout.frames.get("f");
    const width = boxWidth(measure, "a");

    expect(graph.frames).toHaveLength(1);
    expect(box?.width).toBe(width);
    expect(frame?.width).toBe(width + FRAME_PAD * 2);
    expect(frame?.height).toBe(BOX_HEIGHT + FRAME_TOP + FRAME_PAD);
  });

  it("reserves the note mark's width in a noted box", async () => {
    const name = "a-module-with-a-long-name";
    const file = `f/${name}.py`;
    const { layout } = await layoutOf(
      scanOf([file], []),
      {},
      measure,
      new Set([file]),
    );
    const plain = boxWidth(measure, name);

    expect(plain).toBeGreaterThan(BOX_MIN_WIDTH);
    expect(layout.boxes.get(file)?.width).toBe(
      plain + NOTE_MARK_SIZE + NOTE_MARK_INSET * 2,
    );
  });

  it("is exactly as wide as its label when the label is wider", async () => {
    const name = "a-very-long-folder-name-indeed";
    const { graph, layout } = await layoutOf(scanOf([`${name}/a.py`], []));
    const frame = layout.frames.get(name);
    const label = frameLabelWidth(
      measure,
      name,
      `${graph.frames[0]?.open} of ${graph.frames[0]?.held}`,
    );

    expect(frame?.width).toBe(label);
    expect(frame?.height).toBe(BOX_HEIGHT + FRAME_TOP + FRAME_PAD);
  });
});

describe("nesting and edges", () => {
  const scan = scanOf(
    ["l/application/work/c.py", "l/application/o.py", "l/ports/s.py"],
    [["l/application/work/c.py", "l/ports/s.py"]],
  );

  it("places nested frames strictly inside their parents", async () => {
    const { layout } = await layoutOf(scan);
    const l = layout.frames.get("l");
    const application = layout.frames.get("l/application");
    const work = layout.frames.get("l/application/work");
    const box = layout.boxes.get("l/application/work/c.py");

    expect(l && application && inside(application, l)).toBe(true);
    expect(application && work && inside(work, application)).toBe(true);
    expect(work && box && inside(box, work)).toBe(true);
  });

  it("returns edge points in root coordinates for a nested container", async () => {
    const { layout, graph } = await layoutOf(scan);
    const points = layout.lines.get(graph.lines[0]?.id as string) ?? [];
    const from = layout.boxes.get("l/application/work/c.py");
    const to = layout.boxes.get("l/ports/s.py");
    const start = points[0];
    const end = points[points.length - 1];
    const near = (
      point: { x: number; y: number } | undefined,
      rect: NonNullable<typeof from>,
    ) =>
      point !== undefined &&
      point.x >= rect.x - 1 &&
      point.x <= rect.x + rect.width + 1 &&
      point.y >= rect.y - 1 &&
      point.y <= rect.y + rect.height + 1;

    expect(from && near(start, from)).toBe(true);
    expect(to && near(end, to)).toBe(true);
  });

  it("leaves a root-level edge unshifted", async () => {
    const { layout, graph } = await layoutOf(
      scanOf(["a.py", "b.py"], [["a.py", "b.py"]]),
    );
    const points = layout.lines.get(graph.lines[0]?.id as string) ?? [];
    const a = layout.boxes.get("a.py");

    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(
      a !== undefined && points[0] !== undefined && points[0].y >= a.y,
    ).toBe(true);
  });
});

describe("metric bar rows", () => {
  const scan = scanOf(["a/x.py", "b/y.py"], []);
  const graphOf = (folded: string[] = []) =>
    buildCanvasGraph({
      scans: [scan],
      modules: scan.modules.map((module) => module.id),
      opened: scan.modules.map((module) => module.id),
      disc: () => "green",
      folded: new Set(folded),
      focus: null,
      showInferred: true,
    });
  const boxes = (rows: Record<string, number>, folded: string[] = []) =>
    (
      toElk(graphOf(folded), measure, new Set(), new Map(Object.entries(rows)))
        .children ?? []
    ).flatMap((node) => [node, ...(node.children ?? [])]);
  const byId = (rows: Record<string, number>, id: string, folded?: string[]) =>
    boxes(rows, folded).find((node) => node.id === id);

  it("gives a module box one row per measured metric and a folder box none", () => {
    for (const n of [1, 2, 3]) {
      const module = byId({ "a/x.py": n }, "a/x.py");

      expect(module?.height).toBe(BOX_HEIGHT + n * BAR_ROW + BAR_BOTTOM_PAD);
      expect(module?.width).toBeGreaterThanOrEqual(BAR_MIN_BOX_WIDTH);
    }

    expect(byId({ "a/x.py": 1 }, "a/x.py")?.height).toBe(60);
    expect(byId({ b: 2 }, "b", ["b"])?.height).toBe(FOLDER_BOX_HEIGHT);
  });

  it("sizes each box by its own row count in one call", () => {
    const rows = { "a/x.py": 3, "b/y.py": 1 };
    const heights = ["a/x.py", "b/y.py"].map((id) => byId(rows, id)?.height);

    expect(heights).toEqual([
      BOX_HEIGHT + 3 * BAR_ROW + BAR_BOTTOM_PAD,
      BOX_HEIGHT + BAR_ROW + BAR_BOTTOM_PAD,
    ]);
    expect(new Set(heights).size).toBe(2);
  });

  it("leaves a box with no measured metric at the plain height", () => {
    expect(byId({}, "a/x.py")?.height).toBe(BOX_HEIGHT);
    expect(byId({ "a/x.py": 0 }, "a/x.py")?.height).toBe(BOX_HEIGHT);
    expect(byId({ "b/y.py": 2 }, "a/x.py")?.height).toBe(BOX_HEIGHT);
    expect(byId({ "a/x.py": 0 }, "a/x.py")?.width).toBeLessThan(
      BAR_MIN_BOX_WIDTH,
    );
  });

  it("widens a narrow box to the minimum and never narrows a wider one", () => {
    expect(byId({ "a/x.py": 1 }, "a/x.py")?.width).toBe(BAR_MIN_BOX_WIDTH);

    const wide = () => 300;
    const node = (
      toElk(graphOf(), wide, new Set(), new Map([["a/x.py", 1]])).children ?? []
    )
      .flatMap((n) => [n, ...(n.children ?? [])])
      .find((n) => n.id === "a/x.py");

    expect(node?.width).toBe(300 + 16 + 20);
  });
});
