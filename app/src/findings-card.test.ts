import type { FindingRecord } from "recognizer";
import { describe, expect, it } from "vitest";
import { litSet, offCanvasModules } from "./findings-card";

const violation: FindingRecord = {
  id: "v",
  kind: "rule-violation",
  severity: "violation",
  principle: "dependency-inversion-principle",
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
  principle: "levelization",
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
