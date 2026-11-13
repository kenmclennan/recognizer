import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FindingRecord, FindingsDocument } from "recognizer";
import { describe, expect, it } from "vitest";
import { buildCatalog, EMPTY_CATALOG } from "./finding-catalog";
import groupFile from "./finding-groups.json";
import { sentenceOf } from "./finding-sentence";
import { groupsOf, headerLine, withEmptyGroups } from "./findings-groups";
import { findingRows } from "./findings-order";
import { shippedSensors } from "./shipped-fake";

const CATALOG = buildCatalog({ status: "ok", sensors: shippedSensors() });

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

const names = (documents: FindingsDocument[], catalog = CATALOG) =>
  groupsOf(findingRows(documents), catalog).map((group) => group.name);

describe("groupsOf", () => {
  it("returns the fixed order and omits empty groups", () => {
    const all = [
      record("th", "thresholds.churn"),
      record("mu", "mutation"),
      record("cr", "crap"),
      record("du", "duplication"),
      record("ue", "unused_exports"),
      record("or", "orphan"),
      record("cy", "cycle"),
      record("rv", "rule-violation", "violation"),
    ];

    expect(names([document("structure", all)])).toEqual([
      "Breaks the policy",
      "Import cycle",
      "Orphan",
      "Unused exports",
      "Duplicated code",
      "C.R.A.P.",
      "Mutations",
      "Over a limit",
    ]);
    expect(names([document("structure", [record("or", "orphan")])])).toEqual([
      "Orphan",
    ]);
  });

  it("groups a stable_abstractions record from an old cached file under its kind", () => {
    const old = document("structure", [
      record("sa", "stable_abstractions", "warning", {
        abstractness: 0,
        instability: 0.23,
      }),
    ]);
    const [group] = groupsOf(findingRows([old]), CATALOG);

    expect(group?.key).toBe("kind:stable_abstractions");
    expect(group?.name).toBe("Stable abstractions");
  });

  it("shows a stable_dependencies record from another file under its kind with its own summary", () => {
    const old = document("review", [
      {
        ...record("sd", "stable_dependencies"),
        summary: "folder a depends on folder b, which is less stable",
      },
      record("c", "cycle"),
    ]);
    const rows = findingRows([old]);
    const groups = groupsOf(rows, CATALOG);
    const shown = groups.find((one) => one.key === "kind:stable_dependencies");

    expect(groups.map((one) => one.key)).toContain("kind:cycle");
    expect(shown?.rows).toHaveLength(1);
    expect(
      sentenceOf({
        record: shown?.rows[0]?.record as FindingRecord,
        reported: false,
      }),
    ).toBe("folder a depends on folder b, which is less stable");
  });

  it("shows a hub record without used_by from another file under its kind with its own summary", () => {
    const old = document("review", [
      {
        ...record("hu", "hub"),
        summary: "app/place.py is imported by 3 modules and imports 3",
      },
      record("c", "cycle"),
    ]);
    const groups = groupsOf(findingRows([old]));
    const shown = groups.find((one) => one.key === "kind:hub");

    expect(groups.map((one) => one.key)).toContain("kind:cycle");
    expect(shown?.rows).toHaveLength(1);
    expect(
      sentenceOf({
        record: shown?.rows[0]?.record as FindingRecord,
        reported: false,
      }),
    ).toBe("app/place.py is imported by 3 modules and imports 3");
  });

  it("shows a folder_cycle record from an old file under its kind with its own summary", () => {
    const old = document("review", [
      {
        ...record("fc", "folder_cycle"),
        summary: "folders a and b import each other",
      },
    ]);
    const rows = findingRows([old]);
    const [group] = groupsOf(rows, CATALOG);

    expect(group?.key).toBe("kind:folder_cycle");
    expect(group?.rows).toHaveLength(1);
    const [row] = rows;

    expect(
      sentenceOf({ record: row?.record as FindingRecord, reported: false }),
    ).toBe("folders a and b import each other");
  });

  it("shows a policy_drift record from an old file under its kind with its own summary", () => {
    const old = document("review", [
      {
        ...record("pd", "policy_drift"),
        summary: "folder a holds 1 scanned modules that no component covers",
      },
    ]);
    const rows = findingRows([old]);
    const [group] = groupsOf(rows, CATALOG);

    expect(group?.key).toBe("kind:policy_drift");
    expect(group?.rows).toHaveLength(1);
    const [row] = rows;

    expect(
      sentenceOf({ record: row?.record as FindingRecord, reported: false }),
    ).toBe("folder a holds 1 scanned modules that no component covers");
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
      CATALOG,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("kind:thresholds");
    expect(groups[0]?.rows).toHaveLength(2);
  });

  it("gives the three shipped sensors' keys in the order crap, mutation, thresholds after the structure groups", () => {
    const groups = groupsOf(
      findingRows([
        document("t", [
          record("th", "thresholds.complexity"),
          record("mu", "mutation"),
          record("cr", "crap"),
          record("or", "orphan"),
        ]),
      ]),
      CATALOG,
    );

    expect(groups.map((group) => group.key)).toEqual([
      "kind:orphan",
      "kind:crap",
      "kind:mutation",
      "kind:thresholds",
    ]);
  });

  it("keeps the generic name and key for a kind the catalog does not know", () => {
    const groups = groupsOf(
      findingRows([document("t", [record("x", "flaky_thing")])]),
      CATALOG,
    );

    expect(groups[0]?.key).toBe("kind:flaky_thing");
    expect(groups[0]?.name).toBe("Flaky thing");
    expect(groups[0]?.help).toBeNull();
  });

  it("gives the generic group to crap, mutation and thresholds rows when the catalog is empty", () => {
    const groups = groupsOf(
      findingRows([
        document("t", [
          record("cr", "crap"),
          record("mu", "mutation"),
          record("th", "thresholds.churn"),
        ]),
      ]),
      EMPTY_CATALOG,
    );

    expect(groups.map((group) => [group.key, group.name, group.help])).toEqual([
      ["kind:crap", "Crap", null],
      ["kind:mutation", "Mutation", null],
      ["kind:thresholds.churn", "Thresholds.churn", null],
    ]);
  });

  it("marks a group red when a row is a violation and keeps rule-violation first", () => {
    const groups = groupsOf(
      findingRows([
        document("t", [
          record("h", "orphan"),
          record("c1", "cycle", "violation"),
          record("c2", "cycle"),
          record("v", "rule-violation", "violation"),
        ]),
      ]),
    );

    expect(groups.map((group) => [group.name, group.severity])).toEqual([
      ["Breaks the policy", "violation"],
      ["Import cycle", "violation"],
      ["Orphan", "warning"],
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
        ...Array.from({ length: warnings }, (_, i) =>
          record(`w${i}`, "orphan"),
        ),
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
    document("structure", [record("or", "orphan")]),
    document("a", [record("du", "duplication")]),
  ]);

  it("adds an empty group for a sensor with no current result, in panel order", () => {
    const groups = withEmptyGroups(
      groupsOf(rows, CATALOG),
      (sensor) => ["crap", "mutation"].includes(sensor),
      CATALOG,
    );

    expect(groups.map((group) => [group.key, group.rows.length])).toEqual([
      ["kind:orphan", 1],
      ["kind:duplication", 1],
      ["kind:crap", 0],
      ["kind:mutation", 0],
    ]);
  });

  it("keeps a group that already has findings and adds nothing when every sensor is current", () => {
    const groups = groupsOf(rows, CATALOG);

    expect(
      withEmptyGroups(groups, () => true, CATALOG).map((g) => g.key),
    ).toEqual([
      "kind:orphan",
      "kind:duplication",
      "kind:crap",
      "kind:mutation",
      "kind:thresholds",
    ]);
    expect(withEmptyGroups(groups, () => false, CATALOG)).toEqual(groups);
  });
});

describe("private imports group", () => {
  it("is placed after Unused exports", () => {
    expect(
      names([
        document("structure", [
          record("pi", "private_imports"),
          record("ue", "unused_exports"),
        ]),
      ]),
    ).toEqual(["Unused exports", "Private imports"]);
  });
});

describe("long functions group", () => {
  it("is placed after Private imports", () => {
    expect(
      names([
        document("structure", [
          record("lf", "long_function"),
          record("pi", "private_imports"),
        ]),
      ]),
    ).toEqual(["Private imports", "Long functions"]);
  });
});

describe("withEmptyGroups with an empty catalog", () => {
  it("adds only the structure sensor's duplication group", () => {
    const groups = withEmptyGroups([], () => true, EMPTY_CATALOG);

    expect(groups.map((g) => g.key)).toEqual(["kind:duplication"]);
  });
});

describe("finding-groups.json", () => {
  const entries = groupFile.groups as {
    key: string;
    name: string;
    means: string;
    todo: string;
  }[];

  it("has the structure sensor's seven unique keys and names with plain help sentences", () => {
    expect(entries.map((one) => one.key)).toEqual([
      "kind:rule-violation",
      "kind:cycle",
      "kind:orphan",
      "kind:unused_exports",
      "kind:private_imports",
      "kind:long_function",
      "kind:duplication",
    ]);
    expect(new Set(entries.map((one) => one.name)).size).toBe(7);

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
    const groups = groupsOf(
      findingRows([document("structure", all)]),
      EMPTY_CATALOG,
    );

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
      groupsOf(rows, CATALOG).map((g) => [g.name, g.help]),
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

    const every = [
      ...entries,
      ...CATALOG.groups.map((one) => ({ name: one.name, ...one.help })),
    ];

    for (const one of every) {
      expect(row).toContain(one.name);
      expect(glossary).not.toContain(one.means);
      expect(glossary).not.toContain(one.todo);
    }
  });
});
