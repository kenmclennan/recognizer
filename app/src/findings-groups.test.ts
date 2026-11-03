import type { FindingRecord, FindingsDocument } from "recognizer";
import { describe, expect, it } from "vitest";
import { groupsOf, headerLine } from "./findings-groups";
import { findingRows } from "./findings-order";

function record(
  id: string,
  kind: string,
  severity: "violation" | "warning" = "warning",
  measures?: Record<string, number>,
): FindingRecord {
  return {
    id,
    kind,
    severity,
    principle: "p",
    summary: id,
    evidence: { modules: [`${id}.py`], ...(measures ? { measures } : {}) },
  };
}

function document(
  name: string,
  findings: FindingRecord[],
  reported = false,
): FindingsDocument {
  return {
    findings_version: 1,
    sensor: { name, version: "1" },
    commit: "c",
    modified: false,
    settings: {},
    ...(reported ? { reported_at: "2026-11-02T10:00:00.000Z" } : {}),
    findings,
  };
}

const names = (documents: FindingsDocument[]) =>
  groupsOf(findingRows(documents)).map((group) => group.name);

describe("groupsOf", () => {
  it("returns the fixed order and omits empty groups", () => {
    const all = [
      record("th", "thresholds.churn"),
      record("mu", "mutation"),
      record("cr", "crap"),
      record("du", "duplication"),
      record("ue", "unused_exports"),
      record("us", "stable_abstractions", "warning", {
        abstractness: 1,
        instability: 1,
      }),
      record("pa", "stable_abstractions", "warning", {
        abstractness: 0,
        instability: 0.23,
      }),
      record("sd", "stable_dependencies"),
      record("pd", "policy_drift"),
      record("or", "orphan"),
      record("hu", "hub"),
      record("fc", "folder_cycle"),
      record("cy", "cycle"),
      record("rv", "rule-violation", "violation"),
    ];

    expect(names([document("structure", all)])).toEqual([
      "Policy violation",
      "Cyclic dependency",
      "Folder cycle",
      "Hub",
      "Orphan",
      "Policy drift",
      "Unstable dependency",
      "Pain zone",
      "Useless zone",
      "Unused exports",
      "Duplication",
      "C.R.A.P.",
      "Mutation",
      "Threshold",
    ]);
    expect(names([document("structure", [record("hu", "hub")])])).toEqual([
      "Hub",
    ]);
  });

  it("puts the boundary of abstractness plus instability equal to 1 in Useless zone", () => {
    expect(
      names([
        document("s", [
          record("b", "stable_abstractions", "warning", {
            abstractness: 0.5,
            instability: 0.5,
          }),
        ]),
      ]),
    ).toEqual(["Useless zone"]);
  });

  it("puts a report under its sensor name after the fixed kinds, then unknown kinds by name", () => {
    expect(
      names([
        document("zeta", [record("z", "zebra")]),
        document("review", [record("r", "cycle")], true),
        document("structure", [record("c", "cycle"), record("a", "alpha")]),
      ]),
    ).toEqual(["Cyclic dependency", "review", "Alpha", "Zebra"]);
  });

  it("groups thresholds of every metric together", () => {
    const groups = groupsOf(
      findingRows([
        document("t", [
          record("a", "thresholds.churn"),
          record("b", "thresholds.complexity"),
        ]),
      ]),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows).toHaveLength(2);
  });

  it("marks a group red when a row is a violation and keeps rule-violation first", () => {
    const groups = groupsOf(
      findingRows([
        document("t", [
          record("h", "hub"),
          record("c1", "cycle", "violation"),
          record("c2", "cycle"),
          record("v", "rule-violation", "violation"),
        ]),
      ]),
    );

    expect(groups.map((group) => [group.name, group.severity])).toEqual([
      ["Policy violation", "violation"],
      ["Cyclic dependency", "violation"],
      ["Hub", "warning"],
    ]);
    expect(groups[1]?.rows.map((row) => row.id)).toEqual(["c1", "c2"]);
  });
});

describe("headerLine", () => {
  const rows = (violations: number, warnings: number) =>
    findingRows([
      document("s", [
        ...Array.from({ length: violations }, (_, i) =>
          record(`v${i}`, "cycle", "violation"),
        ),
        ...Array.from({ length: warnings }, (_, i) => record(`w${i}`, "hub")),
      ]),
    ]);

  it("omits a zero part and uses the singular for one", () => {
    expect(headerLine(rows(2, 104))).toBe("2 violations, 104 warnings");
    expect(headerLine(rows(0, 106))).toBe("106 warnings");
    expect(headerLine(rows(1, 0))).toBe("1 violation");
    expect(headerLine(rows(0, 1))).toBe("1 warning");
    expect(headerLine([])).toBeNull();
  });
});
