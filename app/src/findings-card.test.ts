import type { FindingRecord } from "recognizer";
import { describe, expect, it } from "vitest";
import { evidenceLines, litSet, offCanvasModules } from "./findings-card";

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

describe("evidenceLines", () => {
  it("lists an edge with its lines, and both cycle edges", () => {
    expect(evidenceLines(violation)).toEqual(["a.py -> b.py at line 4, 12"]);
    expect(evidenceLines(cycle)).toEqual(["a.py -> b.py", "b.py -> a.py"]);
  });

  it("lists members then measures in key order for a hub", () => {
    expect(evidenceLines(hub)).toEqual([
      "a.py: Thing",
      "fan_in: 3",
      "fan_out: 3",
      "threshold: 3",
    ]);
  });

  it("adds the not on the canvas line only when ids are passed", () => {
    expect(evidenceLines(cycle)).not.toContain("not on the canvas: b.py");
    expect(evidenceLines(cycle, ["b.py"])).toContain("not on the canvas: b.py");
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
