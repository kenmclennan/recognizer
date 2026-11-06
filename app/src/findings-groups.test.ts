import type { FindingRecord, FindingsDocument } from "recognizer";
import { describe, expect, it } from "vitest";
import { groupsOf, headerLine, staleNote } from "./findings-groups";
import { findingRows, type StaleRow } from "./findings-order";

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

  it("groups a stable_abstractions record from an old cached file under its kind", () => {
    const old = document("structure", [
      record("sa", "stable_abstractions", "warning", {
        abstractness: 0,
        instability: 0.23,
      }),
    ]);
    const [group] = groupsOf(findingRows([old]));

    expect(group?.key).toBe("kind:stable_abstractions");
    expect(group?.name).toBe("Stable abstractions");
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

function sensorRow(name: string, chip: string): StaleRow {
  return { name, kind: "registered", chip };
}

describe("staleNote", () => {
  const rows = findingRows([
    document("structure", [record("hu", "hub")]),
    document("a", [
      record("sd", "stable_dependencies"),
      record("du", "duplication"),
    ]),
    document("b", [record("mu", "mutation")]),
  ]);

  const hiddenOf = (sensor: string) =>
    rows.filter((row) => row.sensor === sensor);

  it("names the groups with a hidden finding in panel order, joined with and", () => {
    expect(staleNote([], hiddenOf("a"), [])).toBe(
      "Unstable dependency and Duplication findings are out of date.",
    );
    expect(staleNote([], hiddenOf("b"), [])).toBe(
      "Mutation findings are out of date.",
    );
    expect(
      staleNote(
        [],
        [...hiddenOf("a"), ...hiddenOf("b")],
        [sensorRow("a", "failed")],
      ),
    ).toBe(
      "Unstable dependency, Duplication and Mutation findings are out of date.",
    );
  });

  it("joins two names with and alone", () => {
    const pair = findingRows([
      document("a", [record("hu", "hub"), record("or", "orphan")]),
    ]);

    expect(staleNote([], pair, [])).toBe(
      "Hub and Orphan findings are out of date.",
    );
  });

  it("says nothing when no finding is hidden", () => {
    expect(staleNote(rows, [], [])).toBeNull();
    expect(
      staleNote(
        rows,
        [],
        [
          sensorRow("a", "stale"),
          sensorRow("b", "ran 2m ago"),
          sensorRow("structure", "runs with every scan"),
        ],
      ),
    ).toBeNull();
  });

  it("still names the groups of a registered sensor that failed", () => {
    expect(staleNote(rows, [], [sensorRow("b", "failed")])).toBe(
      "Mutation findings are out of date.",
    );
  });
});
