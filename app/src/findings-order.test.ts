import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FindingRecord, FindingsDocument } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  badge,
  findingRows,
  orderFindings,
  walkFindings,
} from "./findings-order";

function record(
  id: string,
  kind: string,
  severity: "violation" | "warning",
  module: string,
): FindingRecord {
  return {
    id,
    kind,
    severity,
    principle: "p",
    summary: `${kind} ${id}`,
    evidence: { modules: [module] },
  };
}

function document(name: string, findings: FindingRecord[]): FindingsDocument {
  return {
    findings_version: 1,
    sensor: { name, version: "1" },
    commit: "c",
    modified: false,
    settings: {},
    findings,
  };
}

const docs = [
  document("structure", [
    record("h1", "hub", "warning", "b.py"),
    record("v2", "rule-violation", "violation", "b.py"),
    record("c1", "cycle", "warning", "a.py"),
    record("v1", "rule-violation", "violation", "a.py"),
    record("v3", "rule-violation", "violation", "b.py"),
  ]),
  document("lint", [record("l1", "style", "warning", "a.py")]),
];

const rows = findingRows(docs);

function duplicate(
  id: string,
  sizes: number[],
  severity = "warning" as const,
): FindingRecord {
  return {
    ...record(id, "duplication", severity, "m.py"),
    evidence: {
      modules: ["m.py"],
      members: sizes.map((size, index) => ({
        module: "m.py",
        name: `n${index}`,
        lines: [1, size] as [number, number],
      })),
    },
  };
}

describe("duplication order", () => {
  it("sorts by lines duplicated descending then id, after other kinds by kind", () => {
    const ordered = orderFindings(
      findingRows([
        document("duplication", [
          duplicate("d-small", [5, 5]),
          duplicate("d-b", [9, 9]),
          duplicate("d-big", [4, 4, 4, 4, 4, 4]),
          duplicate("d-a", [9, 9]),
        ]),
        document("crap", [record("c1", "crap", "warning", "a.py")]),
      ]),
    );

    expect(ordered.map((row) => row.id)).toEqual([
      "c1",
      "d-big",
      "d-a",
      "d-b",
      "d-small",
    ]);
  });
});

describe("findingRows", () => {
  it("makes one row per record with the first evidence module and the sensor name", () => {
    expect(rows).toHaveLength(6);
    expect(rows.find((row) => row.id === "l1")).toMatchObject({
      module: "a.py",
      sensor: "lint",
      severity: "warning",
    });
  });

  it("reads the committed structure example as nine rows, rule violation first", () => {
    const text = readFileSync(
      fileURLToPath(
        new URL(
          "../../schema/findings-examples/valid/structure.json",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const real = findingRows([JSON.parse(text) as FindingsDocument]);
    const ordered = orderFindings(real);

    expect(ordered.map((row) => row.kind)).toEqual([
      "rule-violation",
      "cycle",
      "folder_cycle",
      "hub",
      "orphan",
      "orphan",
      "policy_drift",
      "policy_drift",
      "stable_dependencies",
    ]);
    expect(badge(real)).toEqual({ count: 1, tone: "red" });
  });
});

describe("orderFindings", () => {
  it("puts violations first, then kind, module and id ascending", () => {
    expect(orderFindings(rows).map((row) => row.id)).toEqual([
      "v1",
      "v2",
      "v3",
      "c1",
      "h1",
      "l1",
    ]);
  });
});

describe("walkFindings", () => {
  const order = orderFindings(rows);

  it("starts at the first or last from no selection", () => {
    expect(walkFindings(order, null, 1)).toBe("v1");
    expect(walkFindings(order, null, -1)).toBe("l1");
  });

  it("walks forward and backward in display order", () => {
    expect(walkFindings(order, "v1", 1)).toBe("v2");
    expect(walkFindings(order, "v2", -1)).toBe("v1");
  });

  it("clamps at both ends", () => {
    expect(walkFindings(order, order.at(-1)?.id ?? null, 1)).toBe("l1");
    expect(walkFindings(order, "c1", 1)).toBe("h1");
    expect(walkFindings(order, "h1", 1)).toBe("l1");
    expect(walkFindings(order, "l1", 1)).toBe("l1");
    expect(walkFindings(order, "v1", -1)).toBe("v1");
  });

  it("returns the active id for an empty list and restarts from a hidden id", () => {
    expect(walkFindings([], "v1", 1)).toBe("v1");
    expect(walkFindings([], null, 1)).toBeNull();
    expect(walkFindings(order, "gone", 1)).toBe("v1");
  });
});

describe("badge", () => {
  it("counts violations in red, shows a bare amber dot for warnings only and nothing at zero", () => {
    expect(badge([])).toEqual({ count: 0, tone: "none" });
    expect(badge(rows.filter((row) => row.severity === "warning"))).toEqual({
      count: 0,
      tone: "amber",
    });
    expect(badge(rows)).toEqual({
      count: rows.filter((row) => row.severity === "violation").length,
      tone: "red",
    });
  });
});
