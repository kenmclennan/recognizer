import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FindingRecord, FindingsDocument } from "recognizer";
import { describe, expect, it } from "vitest";
import type { Scene, SceneBox } from "./canvas-scene";
import { ghostPlacement, keepsFocus, rowDetail } from "./finding-focus";

const violation: FindingRecord = {
  id: "v",
  kind: "rule-violation",
  severity: "violation",
  principle: "dependencies-follow-the-policy",
  summary: "depends on b.py",
  evidence: {
    modules: ["a.py"],
    edges: [{ from: "a.py", to: "b.py", kind: "depends", lines: [4, 12] }],
  },
};

const cycle: FindingRecord = {
  id: "c",
  kind: "cycle",
  severity: "warning",
  principle: "no-cycles",
  summary: "cycle of 2",
  fix_pattern: "break-cycle",
  evidence: {
    modules: ["a.py", "b.py"],
    edges: [
      { from: "a.py", to: "b.py", kind: "depends" },
      { from: "b.py", to: "a.py", kind: "depends" },
    ],
  },
};

const hub: FindingRecord = {
  id: "h",
  kind: "hub",
  severity: "warning",
  principle: "small-fan-in",
  summary: "hub",
  evidence: { modules: ["hub.py"], measures: { fan_in: 12 } },
};

function sceneOf(...ids: string[]): Scene {
  const boxes = ids.map(
    (id, index): SceneBox => ({
      id,
      kind: "module",
      rect: { x: index * 300, y: 20, width: 200, height: 50 },
      label: id,
      figures: "",
      subline: "",
      disc: "green",
    }),
  );

  return {
    drawOrder: ["frames", "lines", "boxes"],
    frames: [],
    lines: [],
    arrows: [],
    boxes,
    bounds: { x: 0, y: 0, width: 600, height: 100 },
  };
}

const same = (id: string) => id;

describe("keepsFocus", () => {
  it("keeps it for the finding's module, an evidence module and an edge end", () => {
    expect(keepsFocus({ kind: "module", id: "a.py" }, violation)).toBe(true);
    expect(keepsFocus({ kind: "module", id: "b.py" }, cycle)).toBe(true);
    expect(keepsFocus({ kind: "module", id: "b.py" }, violation)).toBe(true);
  });

  it("drops it for a module outside, an edge and no selection", () => {
    expect(keepsFocus({ kind: "module", id: "z.py" }, violation)).toBe(false);
    expect(keepsFocus({ kind: "edge", id: "a.py>b.py" }, violation)).toBe(
      false,
    );
    expect(keepsFocus(null, violation)).toBe(false);
  });

  it("keeps it for a folded folder's box that holds an evidence module", () => {
    const boxFor = (id: string) => (id.startsWith("src/") ? "src" : id);

    expect(
      keepsFocus(
        { kind: "folder", id: "src" },
        { ...violation, evidence: { modules: ["src/a.py"] } },
        boxFor,
      ),
    ).toBe(true);
  });
});

describe("rowDetail", () => {
  it("opens a violation at the first edge's first line", () => {
    const detail = rowDetail(violation);

    expect(detail.open).toEqual({ module: "a.py", line: 4 });
    expect(detail.lines).toEqual(["a.py -> b.py at line 4, 12"]);
    expect(detail.fix).toBe("no fix pattern recorded");
  });

  it("opens a cycle at its first module with no line, and names the fix", () => {
    const detail = rowDetail(cycle);

    expect(detail.open).toEqual({ module: "a.py", line: null });
    expect(detail.fix).toBe("break-cycle");
  });

  it("says no fix pattern is recorded for a hub with only measures", () => {
    const detail = rowDetail(hub);

    expect(detail.fix).toBe("no fix pattern recorded");
    expect(detail.lines).toEqual(["fan_in: 12"]);
    expect(detail.open).toEqual({ module: "hub.py", line: null });
  });
});

describe("ghostPlacement", () => {
  it("places the off-canvas end beside the other end of the edge", () => {
    const [ghost] = ghostPlacement(violation, same, sceneOf("a.py"));

    expect(ghost).toEqual({
      id: "b.py",
      name: "b.py",
      partner: "a.py",
      rect: { x: 240, y: 20, width: 200, height: 50 },
      edge: { from: "a.py", to: "b.py" },
    });
  });

  it("pairs a module only in evidence.modules with the finding's module", () => {
    const record: FindingRecord = {
      ...hub,
      evidence: { modules: ["hub.py", "x/other.py"] },
    };
    const ghosts = ghostPlacement(record, same, sceneOf("hub.py"));

    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]?.partner).toBe("hub.py");
    expect(ghosts[0]?.name).toBe("other.py");
    expect(ghosts[0]?.edge).toBeNull();
  });

  it("stacks two ghosts of one partner one box height plus 16 apart", () => {
    const record: FindingRecord = {
      ...violation,
      evidence: {
        modules: ["a.py"],
        edges: [
          { from: "a.py", to: "b.py", kind: "depends" },
          { from: "a.py", to: "c.py", kind: "depends" },
        ],
      },
    };
    const [first, second] = ghostPlacement(record, same, sceneOf("a.py"));

    expect((second?.rect.y ?? 0) - (first?.rect.y ?? 0)).toBe(50 + 16);
    expect(second?.rect.x).toBe(first?.rect.x);
  });

  it("omits a ghost whose partner is also off the canvas", () => {
    expect(ghostPlacement(violation, same, sceneOf("z.py"))).toEqual([]);
  });
});

describe("the committed findings example", () => {
  it("opens its first record at the evidence line", () => {
    const file = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../schema/findings-examples/valid/structure.json",
    );
    const document = JSON.parse(readFileSync(file, "utf8")) as FindingsDocument;
    const detail = rowDetail(document.findings[0] as FindingRecord);

    expect(detail.open).toEqual({ module: "shop/domain/order.py", line: 4 });
    expect(detail.lines).toEqual([
      "shop/domain/order.py -> shop/adapters/memory_store.py at line 4, 12",
    ]);
  });
});
