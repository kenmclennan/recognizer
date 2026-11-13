import { describe, expect, it } from "vitest";
import { carryDuplication } from "../src/duplication/carry.js";
import type {
  FindingRecord,
  FindingsDocument,
} from "../src/findings-document.js";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  type StructureSettings,
} from "../src/structure-sensor.js";

const SETTINGS: StructureSettings = DEFAULT_STRUCTURE_SETTINGS;

function duplicate(id: string): FindingRecord {
  return {
    id,
    kind: "duplication",
    severity: "warning",
    principle: "dont-repeat-yourself",
    summary: id,
    evidence: { modules: ["a.py"] },
  };
}

function document(overrides: Partial<FindingsDocument> = {}): FindingsDocument {
  return {
    findings_version: 2,
    sensor: { name: "structure", version: "18" },
    commit: "c1",
    modified: false,
    settings: { entry_points: [] },
    findings: [],
    inputs: { "a.py": "1", "b.py": "2" },
    ...overrides,
  };
}

function stored(overrides: Partial<FindingsDocument> = {}): FindingsDocument {
  return document({
    settings: { entry_points: [], duplication: { ...SETTINGS.duplication } },
    findings: [duplicate("duplication:a"), duplicate("duplication:b")],
    ...overrides,
  });
}

describe("carryDuplication", () => {
  it("copies the stored duplication when commit, settings and inputs are equal", () => {
    const carried = carryDuplication(stored(), document(), SETTINGS);

    expect(carried.findings.map((one) => one.id)).toEqual([
      "duplication:a",
      "duplication:b",
    ]);
    expect(carried.findings.length).toBeGreaterThan(0);
    expect(carried.settings.duplication).toEqual(SETTINGS.duplication);
  });

  it("copies nothing and records nothing when one module hash differs", () => {
    const carried = carryDuplication(
      stored({ inputs: { "a.py": "1", "b.py": "changed" } }),
      document(),
      SETTINGS,
    );

    expect(carried.findings).toEqual([]);
    expect(carried.settings.duplication).toBeUndefined();
  });

  it("copies nothing when the settings differ", () => {
    const carried = carryDuplication(
      stored({
        settings: {
          entry_points: [],
          duplication: { ...SETTINGS.duplication, threshold: 0.9 },
        },
      }),
      document(),
      SETTINGS,
    );

    expect(carried.findings).toEqual([]);
    expect(carried.settings.duplication).toBeUndefined();
  });

  it("copies nothing when the commit differs", () => {
    const carried = carryDuplication(
      stored({ commit: "c0" }),
      document(),
      SETTINGS,
    );

    expect(carried.findings).toEqual([]);
  });

  it("copies nothing when there is no stored document", () => {
    const carried = carryDuplication(null, document(), SETTINGS);

    expect(carried.findings).toEqual([]);
    expect(carried.settings.duplication).toBeUndefined();
  });

  it("copies nothing while duplication is switched off", () => {
    const carried = carryDuplication(stored(), document(), {
      ...SETTINGS,
      duplication: false,
    });

    expect(carried.findings).toEqual([]);
  });
});
