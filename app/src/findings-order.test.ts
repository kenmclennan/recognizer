import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FindingRecord, FindingsDocument } from "recognizer";
import { describe, expect, it } from "vitest";
import type { FindingGroup } from "./findings-order";
import {
  applyFilter,
  badge,
  chips,
  findingRows,
  groupCount,
  groupFindings,
  kindLabel,
  orderFindings,
  severityLabel,
  staleNote,
  walkFindings,
} from "./findings-order";
import type { SensorRow } from "./sensors-panel-model";

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

function sensorRow(
  name: string,
  chip: string,
  kind: SensorRow["kind"] = "registered",
): SensorRow {
  return {
    name,
    kind,
    tickable: kind === "registered",
    ticked: false,
    chip,
    tone: "muted",
    reason: null,
  };
}

describe("findingRows", () => {
  it("makes one row per record with the first evidence module and the sensor name", () => {
    expect(rows).toHaveLength(6);
    expect(rows.find((row) => row.id === "l1")).toMatchObject({
      module: "a.py",
      sensor: "lint",
      severity: "warning",
    });
  });

  it("reads the committed structure example as three rows, rule violation first", () => {
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
      "hub",
    ]);
    expect(badge(real)).toEqual({ count: 3, tone: "red" });
  });
});

describe("orderFindings and groupFindings", () => {
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

  it("groups by severity then kind and omits empty groups", () => {
    const groups = groupFindings(rows);

    expect(groups.map((group) => group.severity)).toEqual([
      "violation",
      "warning",
    ]);
    expect(groups[0]?.kinds.map((group) => group.kind)).toEqual([
      "rule-violation",
    ]);
    expect(groups[1]?.kinds.map((group) => group.kind)).toEqual([
      "cycle",
      "hub",
      "style",
    ]);
    expect(
      groupFindings(rows.filter((row) => row.severity === "warning")).map(
        (group) => group.severity,
      ),
    ).toEqual(["warning"]);
  });
});

describe("applyFilter", () => {
  it("narrows by severity and by sensor", () => {
    expect(applyFilter(rows, { by: "all" })).toHaveLength(6);
    expect(
      applyFilter(rows, { by: "severity", severity: "violation" }),
    ).toHaveLength(3);
    expect(applyFilter(rows, { by: "sensor", name: "lint" })).toHaveLength(1);
  });

  it("treats a sensor with no current document as all", () => {
    expect(applyFilter(rows, { by: "sensor", name: "gone" })).toHaveLength(6);
  });
});

describe("chips", () => {
  it("lists all, severities with rows and each sensor with counts", () => {
    expect(chips(rows).map((chip) => [chip.label, chip.count])).toEqual([
      ["all", 6],
      ["violations", 3],
      ["warnings", 3],
      ["lint", 1],
      ["structure", 5],
    ]);
  });

  it("omits a severity chip without rows and offers no absent sensor", () => {
    const warnings = rows.filter((row) => row.severity === "warning");

    expect(chips(warnings).map((chip) => chip.label)).toEqual([
      "all",
      "warnings",
      "lint",
      "structure",
    ]);
  });
});

describe("walkFindings", () => {
  const order = orderFindings(rows);

  it("starts at the first or last from no selection", () => {
    expect(walkFindings(rows, null, 1)).toBe("v1");
    expect(walkFindings(rows, null, -1)).toBe("l1");
  });

  it("walks forward and backward in display order", () => {
    expect(walkFindings(rows, "v1", 1)).toBe("v2");
    expect(walkFindings(rows, "v2", -1)).toBe("v1");
  });

  it("clamps at both ends", () => {
    expect(walkFindings(rows, order.at(-1)?.id ?? null, 1)).toBe("l1");
    expect(walkFindings(rows, "c1", 1)).toBe("h1");
    expect(walkFindings(rows, "h1", 1)).toBe("l1");
    expect(walkFindings(rows, "l1", 1)).toBe("l1");
    expect(walkFindings(rows, "v1", -1)).toBe("v1");
  });

  it("returns the active id for an empty list and restarts from a hidden id", () => {
    expect(walkFindings([], "v1", 1)).toBe("v1");
    expect(walkFindings([], null, 1)).toBeNull();
    expect(walkFindings(rows, "gone", 1)).toBe("v1");
  });
});

describe("badge", () => {
  it("is none at zero, amber for warnings and red with a violation", () => {
    expect(badge([])).toEqual({ count: 0, tone: "none" });
    expect(badge(rows.filter((row) => row.severity === "warning"))).toEqual({
      count: 3,
      tone: "amber",
    });
    expect(badge(rows)).toEqual({ count: 6, tone: "red" });
  });
});

describe("staleNote", () => {
  it("names stale, failed and not run registered sensors in config order", () => {
    expect(
      staleNote([
        sensorRow("structure", "runs with every scan", "structure"),
        sensorRow("a", "stale"),
        sensorRow("b", "failed"),
        sensorRow("c", "ran 2m ago"),
        sensorRow("d", "not run"),
        sensorRow("e", "running"),
      ]),
    ).toBe("Not current: a (stale), b (failed), d (not run)");
  });

  it("is null when every sensor ran", () => {
    expect(
      staleNote([sensorRow("a", "ran"), sensorRow("b", "ran 1m ago")]),
    ).toBeNull();
    expect(staleNote([])).toBeNull();
  });
});

describe("group headings", () => {
  it("turns a kind id into a readable label", () => {
    expect(kindLabel("rule-violation")).toBe("Rule violation");
    expect(kindLabel("unused_export")).toBe("Unused export");
    expect(kindLabel("cycle")).toBe("Cycle");
  });

  it("names a severity once and counts its rows across kinds", () => {
    const groups = groupFindings(
      findingRows([
        document("structure", [
          record("a", "rule-violation", "violation", "x.py"),
          record("b", "rule-violation", "violation", "y.py"),
          record("c", "cycle", "violation", "z.py"),
        ]),
      ]),
    );

    expect(groups).toHaveLength(1);
    expect(severityLabel("violation")).toBe("Violations");
    expect(severityLabel("warning")).toBe("Warnings");
    expect(groupCount(groups[0] as FindingGroup)).toBe(3);
  });
});
