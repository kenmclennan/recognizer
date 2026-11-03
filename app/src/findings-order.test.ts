import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FindingRecord, FindingsDocument } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  badge,
  findingRows,
  orderFindings,
  staleNote,
  walkFindings,
} from "./findings-order";
import type { SensorRow } from "./scan-panel-model";

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
    extra: null,
    reason: null,
    removable: false,
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
      "policy_drift",
      "policy_drift",
      "stable_abstractions",
      "stable_dependencies",
    ]);
    expect(badge(real)).toEqual({ count: 9, tone: "red" });
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

  it("appends a report whose commit is not the scan's and omits a current one", () => {
    expect(
      staleNote(
        [sensorRow("a", "stale")],
        [
          {
            name: "review",
            chip: "reported 1 minute ago",
            commit: "abc1234",
            stale: true,
          },
          {
            name: "fresh",
            chip: "reported just now",
            commit: "def5678",
            stale: false,
          },
        ],
      ),
    ).toBe("Not current: a (stale), review (reported at abc1234)");
    expect(
      staleNote(
        [],
        [
          {
            name: "fresh",
            chip: "reported just now",
            commit: "def5678",
            stale: false,
          },
        ],
      ),
    ).toBeNull();
  });

  it("is null when every sensor ran", () => {
    expect(
      staleNote([sensorRow("a", "ran"), sensorRow("b", "ran 1m ago")]),
    ).toBeNull();
    expect(staleNote([])).toBeNull();
  });
});
