import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  type SensorFindings,
  STRUCTURE_SENSOR_VERSION,
  type StructureSettings,
  storedStructureReusable,
} from "../../src/index.js";

const SETTINGS: StructureSettings = DEFAULT_STRUCTURE_SETTINGS;

function documentFor(
  settings: StructureSettings,
  overrides: Partial<SensorFindings> = {},
): SensorFindings {
  return {
    sensor: { name: "structure", version: STRUCTURE_SENSOR_VERSION },
    commit: "abc",
    modified: false,
    settings: { ...settings },
    findings: [],
    ...overrides,
  } as SensorFindings;
}

function context(settings: StructureSettings = SETTINGS) {
  return { commit: "abc", settings, unknownFiles: null };
}

describe("storedStructureReusable", () => {
  it("is reusable when every condition holds", () => {
    expect(storedStructureReusable(documentFor(SETTINGS), context())).toBe(
      true,
    );
  });

  it("is not reusable when the commit differs", () => {
    expect(storedStructureReusable(documentFor(SETTINGS), context())).toBe(
      true,
    );
    expect(
      storedStructureReusable(
        documentFor(SETTINGS, { commit: "other" }),
        context(),
      ),
    ).toBe(false);
  });

  it("is not reusable when the document was written from a modified tree", () => {
    expect(storedStructureReusable(documentFor(SETTINGS), context())).toBe(
      true,
    );
    expect(
      storedStructureReusable(
        documentFor(SETTINGS, { modified: true }),
        context(),
      ),
    ).toBe(false);
  });

  it("is not reusable when the unknown files differ", () => {
    expect(storedStructureReusable(documentFor(SETTINGS), context())).toBe(
      true,
    );
    expect(
      storedStructureReusable(documentFor(SETTINGS), {
        ...context(),
        unknownFiles: { total: 1, byExtension: { ".x": 1 } } as never,
      }),
    ).toBe(false);
  });

  it("is not reusable when the sensor version differs", () => {
    expect(storedStructureReusable(documentFor(SETTINGS), context())).toBe(
      true,
    );
    expect(
      storedStructureReusable(
        documentFor(SETTINGS, {
          sensor: { name: "structure", version: "0" },
        }),
        context(),
      ),
    ).toBe(false);
  });

  it("is not reusable when the recorded duplication settings differ", () => {
    expect(storedStructureReusable(documentFor(SETTINGS), context())).toBe(
      true,
    );
    expect(
      storedStructureReusable(
        documentFor(SETTINGS, {
          settings: { ...SETTINGS, duplication: { other: 1 } },
        }),
        context(),
      ),
    ).toBe(false);
  });

  it("is not reusable when the recorded complexity limit differs", () => {
    expect(storedStructureReusable(documentFor(SETTINGS), context())).toBe(
      true,
    );
    expect(
      storedStructureReusable(
        documentFor(SETTINGS, {
          settings: {
            ...SETTINGS,
            complexity_limit: SETTINGS.complexity_limit + 1,
          },
        }),
        context(),
      ),
    ).toBe(false);
  });

  it("is not reusable when another setting differs", () => {
    expect(storedStructureReusable(documentFor(SETTINGS), context())).toBe(
      true,
    );
    expect(
      storedStructureReusable(
        documentFor(SETTINGS, {
          settings: { ...SETTINGS, entry_points: ["x"] },
        }),
        context(),
      ),
    ).toBe(false);
  });

  it("treats a recorded complexity limit as a mismatch when complexity warnings are off", () => {
    const off: StructureSettings = {
      ...SETTINGS,
      warnings: { ...SETTINGS.warnings, complexity: false },
    };
    const { complexity_limit: _limit, ...without } = { ...off };

    expect(
      storedStructureReusable(
        documentFor(off, { settings: without }),
        context(off),
      ),
    ).toBe(true);
    expect(storedStructureReusable(documentFor(off), context(off))).toBe(false);
  });

  it("accepts a missing recorded complexity limit when complexity warnings are on", () => {
    const { complexity_limit: _limit, ...without } = { ...SETTINGS };

    expect(
      storedStructureReusable(
        documentFor(SETTINGS, { settings: without }),
        context(),
      ),
    ).toBe(true);
  });
});
