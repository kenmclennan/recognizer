import type { FindingRecord } from "recognizer";
import { describe, expect, it } from "vitest";
import { cardText, litSet, offCanvasModules } from "./findings-card";
import type { FindingRow } from "./findings-order";

function rowOf(record: FindingRecord, sensor = "structure"): FindingRow {
  return {
    id: record.id,
    module: record.evidence.modules[0] as string,
    kind: record.kind,
    severity: record.severity,
    summary: record.summary,
    principle: record.principle,
    sensor,
    record,
  };
}

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
      { from: "a.py", to: "b.py" },
      { from: "b.py", to: "a.py" },
    ],
  },
};

const hub: FindingRecord = {
  id: "h",
  kind: "hub",
  severity: "warning",
  principle: "narrow",
  summary: "hub",
  fix_pattern: "split-hub",
  evidence: {
    modules: ["a.py"],
    members: [{ module: "a.py", name: "Thing" }],
    measures: { fan_out: 3, fan_in: 3, threshold: 3 },
  },
};

describe("cardText", () => {
  it("shows an edge with its lines and no fix pattern for a violation", () => {
    expect(cardText(rowOf(violation))).toEqual([
      "rule-violation - structure",
      "depends on b.py",
      "a.py -> b.py at line 4, 12",
      "Principle: dependencies-follow-the-policy",
    ]);
  });

  it("shows both cycle edges and the fix pattern", () => {
    expect(cardText(rowOf(cycle))).toEqual([
      "cycle - structure",
      "cycle of 2",
      "a.py -> b.py",
      "b.py -> a.py",
      "Principle: no-cycles",
      "Fix: break-cycle",
    ]);
  });

  it("shows members and measures in key order for a hub", () => {
    expect(cardText(rowOf(hub))).toEqual([
      "hub - structure",
      "hub",
      "a.py: Thing",
      "fan_in: 3",
      "fan_out: 3",
      "threshold: 3",
      "Principle: narrow",
      "Fix: split-hub",
    ]);
  });

  it("adds the not on the canvas line only when ids are passed", () => {
    expect(cardText(rowOf(cycle))).not.toContain("not on the canvas: b.py");
    expect(cardText(rowOf(cycle), ["b.py"])).toContain(
      "not on the canvas: b.py",
    );
  });
});

describe("litSet", () => {
  const same = (id: string) => id;
  const boxes = new Set(["a.py", "b.py"]);

  it("lights the boxes and every line between them whatever its style", () => {
    const lit = litSet(
      violation,
      same,
      ["a.py>b.py:solid:1", "a.py>b.py:dashed:2", "b.py>a.py:solid:1"],
      boxes,
    );

    expect([...lit].sort()).toEqual([
      "a.py",
      "a.py>b.py:dashed:2",
      "a.py>b.py:solid:1",
      "b.py",
    ]);
  });

  it("uses the box id of a folded folder, not the module", () => {
    const fold = (id: string) => (id === "b.py" ? "pkg" : id);
    const lit = litSet(
      violation,
      fold,
      ["a.py>pkg:solid:1"],
      new Set(["a.py", "pkg"]),
    );

    expect([...lit].sort()).toEqual(["a.py", "a.py>pkg:solid:1", "pkg"]);
  });

  it("drops an evidence module that is not on the canvas and names it", () => {
    const lit = litSet(cycle, same, ["a.py>b.py:solid:1"], new Set(["a.py"]));

    expect([...lit]).toEqual(["a.py"]);
    expect(offCanvasModules(cycle, same, new Set(["a.py"]))).toEqual(["b.py"]);
  });

  it("lights the box and no line when both endpoints fold into one box", () => {
    const fold = () => "pkg";
    const lit = litSet(cycle, fold, ["pkg>pkg:solid:1"], new Set(["pkg"]));

    expect([...lit]).toEqual(["pkg"]);
  });
});
