import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FindingRecord, FindingsDocument } from "recognizer";
import { describe, expect, it } from "vitest";
import groupFile from "./finding-groups.json";
import { sentenceOf } from "./finding-sentence";
import { groupsOf, headerLine, withEmptyGroups } from "./findings-groups";
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
      record("sd", "stable_dependencies"),
      record("pd", "policy_drift"),
      record("or", "orphan"),
      record("hu", "hub"),
      record("cy", "cycle"),
      record("rv", "rule-violation", "violation"),
    ];

    expect(names([document("structure", all)])).toEqual([
      "Breaks the policy",
      "Import cycle",
      "Hub",
      "Orphan",
      "Policy out of step",
      "Depends on less stable code",
      "Unused exports",
      "Duplicated code",
      "C.R.A.P.",
      "Mutations",
      "Over a limit",
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

  it("shows a folder_cycle record from an old file under its kind with its own summary", () => {
    const old = document("review", [
      {
        ...record("fc", "folder_cycle"),
        summary: "folders a and b import each other",
      },
    ]);
    const rows = findingRows([old]);
    const [group] = groupsOf(rows);

    expect(group?.key).toBe("kind:folder_cycle");
    expect(group?.rows).toHaveLength(1);
    const [row] = rows;

    expect(
      sentenceOf({ record: row?.record as FindingRecord, reported: false }),
    ).toBe("folders a and b import each other");
  });

  it("puts a report under its sensor name after the fixed kinds, then unknown kinds by name", () => {
    expect(
      names([
        document("zeta", [record("z", "zebra")]),
        document("review", [record("r", "cycle")], true),
        document("structure", [record("c", "cycle"), record("a", "alpha")]),
      ]),
    ).toEqual(["Import cycle", "review", "Alpha", "Zebra"]);
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
      ["Breaks the policy", "violation"],
      ["Import cycle", "violation"],
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

describe("withEmptyGroups", () => {
  const rows = findingRows([
    document("structure", [record("hu", "hub")]),
    document("a", [record("du", "duplication")]),
  ]);

  it("adds an empty group for a sensor with no current result, in panel order", () => {
    const groups = withEmptyGroups(groupsOf(rows), (sensor) =>
      ["crap", "mutation"].includes(sensor),
    );

    expect(groups.map((group) => [group.key, group.rows.length])).toEqual([
      ["kind:hub", 1],
      ["kind:duplication", 1],
      ["kind:crap", 0],
      ["kind:mutation", 0],
    ]);
  });

  it("keeps a group that already has findings and adds nothing when every sensor is current", () => {
    const groups = groupsOf(rows);

    expect(withEmptyGroups(groups, () => true).map((g) => g.key)).toEqual([
      "kind:hub",
      "kind:duplication",
      "kind:crap",
      "kind:mutation",
      "kind:thresholds",
    ]);
    expect(withEmptyGroups(groups, () => false)).toEqual(groups);
  });
});

describe("finding-groups.json", () => {
  const entries = groupFile.groups as {
    key: string;
    name: string;
    means: string;
    todo: string;
  }[];

  it("has eleven unique keys and names with plain help sentences", () => {
    expect(entries.map((one) => one.key)).toEqual([
      "kind:rule-violation",
      "kind:cycle",
      "kind:hub",
      "kind:orphan",
      "kind:policy_drift",
      "kind:stable_dependencies",
      "kind:unused_exports",
      "kind:duplication",
      "kind:crap",
      "kind:mutation",
      "kind:thresholds",
    ]);
    expect(new Set(entries.map((one) => one.name)).size).toBe(11);

    for (const one of entries) {
      expect(one.name).not.toBe("");
      expect(one.means).toMatch(/^[A-Z].*\.$/);
      expect(one.todo).toMatch(/^[A-Z].*\.$/);
      expect(`${one.means}${one.todo}`).not.toMatch(/[<>]/);
    }
  });

  it("is what groupsOf names, orders and explains", () => {
    const all = entries.map((one, index) =>
      record(`r${index}`, one.key.slice("kind:".length)),
    );
    const groups = groupsOf(findingRows([document("structure", all)]));

    expect(groups.map((g) => g.name)).toEqual(entries.map((one) => one.name));
    expect(groups.map((g) => g.help)).toEqual(
      entries.map((one) => ({ means: one.means, todo: one.todo })),
    );
  });

  it("gives no help to a reported group or an unknown kind", () => {
    const rows = findingRows([
      document("structure", [record("a", "cycle")]),
      document("alpha", [record("b", "note")], true),
      document("structure", [
        record("c", "style"),
        record("d", "stable_abstractions"),
      ]),
    ]);
    const byName = Object.fromEntries(
      groupsOf(rows).map((g) => [g.name, g.help]),
    );

    expect(byName["Import cycle"]).not.toBeNull();
    expect(byName.alpha).toBeNull();
    expect(byName.Style).toBeNull();
    expect(byName["Stable abstractions"]).toBeNull();
  });

  it("is named by the glossary but its help text is not repeated there", () => {
    const glossary = readFileSync(
      resolve(__dirname, "../../docs/glossary.md"),
      "utf8",
    );
    const row = glossary
      .split("\n")
      .find((line) => line.startsWith("| Finding group name |"));

    expect(row).toBeDefined();

    for (const one of entries) {
      expect(row).toContain(one.name);
      expect(glossary).not.toContain(one.means);
      expect(glossary).not.toContain(one.todo);
    }
  });
});
