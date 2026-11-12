import type { FindingRecord } from "recognizer";
import { describe, expect, it } from "vitest";
import { keepsFocus } from "./finding-focus";
import { findingRows } from "./findings-order";

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

describe("a finding with no module", () => {
  const lint: FindingRecord = {
    id: "lint:whole-repository",
    kind: "lint",
    severity: "warning",
    principle: "tidy",
    summary: "the repository has a lint problem",
    evidence: { modules: [] },
  };

  it("makes a row with an empty module", () => {
    const [row] = findingRows([
      {
        findings_version: 1,
        sensor: { name: "structure", version: "2" },
        commit: "c",
        modified: false,
        settings: {},
        findings: [lint],
      },
    ]);

    expect(row?.module).toBe("");
  });
});
