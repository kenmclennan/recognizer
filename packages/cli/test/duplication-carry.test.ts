import { describe, expect, it } from "vitest";
import {
  carryMeasured as carryDuplication,
  carryMeasured,
  complexityUnmeasured,
} from "../src/duplication/carry.js";
import { DEFAULT_DUPLICATION_SETTINGS } from "../src/duplication/findings.js";
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
          entry_annotations: [],
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

function complexityFinding(id: string): FindingRecord {
  return {
    id,
    kind: "complexity",
    severity: "warning",
    principle: "cyclomatic-complexity-limit",
    summary: id,
    evidence: { modules: ["a.py"] },
  };
}

function storedBoth(limit: number | null = 10): FindingsDocument {
  return stored({
    settings: {
      entry_points: [],
      duplication: { ...SETTINGS.duplication },
      ...(limit === null ? {} : { complexity_limit: limit }),
    },
    findings: [
      duplicate("duplication:a"),
      complexityFinding("complexity:a.py::f"),
    ],
  });
}

describe("carryMeasured complexity", () => {
  it("carries stored complexity when commit, inputs and limit match", () => {
    const carried = carryMeasured(storedBoth(), document(), SETTINGS);

    expect(carried.findings.map((one) => one.id)).toEqual([
      "duplication:a",
      "complexity:a.py::f",
    ]);
    expect(carried.settings.complexity_limit).toBe(10);
    expect(complexityUnmeasured(carried, SETTINGS)).toBe(false);
  });

  it("does not carry complexity judged against another limit", () => {
    const carried = carryMeasured(storedBoth(15), document(), SETTINGS);

    expect(carried.findings.map((one) => one.id)).toEqual(["duplication:a"]);
    expect(complexityUnmeasured(carried, SETTINGS)).toBe(true);
  });

  it("does not carry complexity when the stored document records no limit", () => {
    const carried = carryMeasured(storedBoth(null), document(), SETTINGS);

    expect(carried.findings.map((one) => one.id)).toEqual(["duplication:a"]);
    expect(complexityUnmeasured(carried, SETTINGS)).toBe(true);
  });

  it("does not carry complexity when the commit or inputs differ", () => {
    expect(
      carryMeasured(storedBoth(), document({ commit: "c2" }), SETTINGS)
        .findings,
    ).toEqual([]);
    expect(
      carryMeasured(
        storedBoth(),
        document({ inputs: { "a.py": "9" } }),
        SETTINGS,
      ).findings,
    ).toEqual([]);
  });

  it("carries complexity while duplication is not carried", () => {
    const carried = carryMeasured(storedBoth(), document(), {
      ...SETTINGS,
      duplication: { ...DEFAULT_DUPLICATION_SETTINGS, threshold: 0.5 },
    });

    expect(carried.findings.map((one) => one.id)).toEqual([
      "complexity:a.py::f",
    ]);
    expect(complexityUnmeasured(carried, SETTINGS)).toBe(false);
    expect(carried.settings.duplication).toBeUndefined();
  });

  it("carries duplication while complexity is not carried", () => {
    const carried = carryMeasured(storedBoth(15), document(), SETTINGS);

    expect(carried.settings.duplication).toBeDefined();
    expect(complexityUnmeasured(carried, SETTINGS)).toBe(true);
  });

  it("reports nothing unmeasured while complexity is switched off", () => {
    const off = {
      ...SETTINGS,
      warnings: { ...SETTINGS.warnings, complexity: false },
    };

    expect(complexityUnmeasured(document(), off)).toBe(false);
    expect(
      carryMeasured(storedBoth(), document(), off).findings.map(
        (one) => one.id,
      ),
    ).toEqual(["duplication:a"]);
  });
});

describe("carryMeasured across sensor versions", () => {
  it("does not carry across sensor versions", () => {
    const fresh = document({ sensor: { name: "structure", version: "19" } });
    const carried = carryMeasured(stored(), fresh, SETTINGS);

    expect(carried).toBe(fresh);
    expect(carried.findings).toEqual([]);
    expect(carried.settings.duplication).toBeUndefined();
  });

  it("still carries when the versions are equal", () => {
    const carried = carryMeasured(stored(), document(), SETTINGS);

    expect(carried.findings.length).toBe(2);
  });
});
