import { describe, expect, it } from "vitest";
import {
  duplicationFaultsIn,
  retiredSensorsIn,
  withMovedDuplicationSensor,
  withoutFaultySensorSettings,
} from "../../src/index.js";

const DUPLICATION =
  "config/sensors/duplication was removed: duplication is now part of structural analysis and runs with every scan; move its settings to sensors.structure.duplication (threshold, min_lines, pair_min_lines, min_nodes), or set sensors.structure.duplication to false to switch it off, and delete the sensors.duplication key";
const UNUSED_EXPORTS =
  "config/sensors/unused-exports was removed: it is now the structure warning unused_exports; add unused_exports: true under sensors.structure.warnings, move any entry_points it listed under warnings.orphan.entry_points, and delete the sensors.unused-exports key";
const PREFIX = "config/sensors/structure/duplication";
const DUPLICATION_PATH = ["sensors", "structure", "duplication"];

function duplication(settings: unknown) {
  return { sensors: { structure: { duplication: settings } } };
}

describe("retiredSensorsIn", () => {
  it.each([
    ["an empty entry", {}],
    ["a null entry", null],
    ["a false entry", false],
    ["an entry with a command", { command: ["x"] }],
  ])("faults sensors.duplication given %s", (_name, entry) => {
    expect(retiredSensorsIn({ sensors: { duplication: entry } })).toEqual([
      { path: ["sensors", "duplication"], message: DUPLICATION },
    ]);
  });

  it("faults a command-less unused-exports entry", () => {
    expect(retiredSensorsIn({ sensors: { "unused-exports": {} } })).toEqual([
      { path: ["sensors", "unused-exports"], message: UNUSED_EXPORTS },
    ]);
  });

  it("accepts an unused-exports entry with a command", () => {
    expect(
      retiredSensorsIn({ sensors: { "unused-exports": { command: ["x"] } } }),
    ).toEqual([]);
  });

  it("lists duplication before unused-exports", () => {
    expect(
      retiredSensorsIn({
        sensors: { "unused-exports": {}, duplication: {} },
      }).map((fault) => fault.message),
    ).toEqual([DUPLICATION, UNUSED_EXPORTS]);
  });

  it.each([
    ["a string", "text"],
    ["null", null],
    ["no sensors", {}],
    ["sensors as a list", { sensors: [] }],
  ])("finds nothing in %s", (_name, document) => {
    expect(retiredSensorsIn(document)).toEqual([]);
  });
});

describe("duplicationFaultsIn", () => {
  it("names unknown settings sorted and joined", () => {
    expect(duplicationFaultsIn(duplication({ b: 1, a: 1 }))).toEqual([
      { path: DUPLICATION_PATH, message: `${PREFIX} unknown setting: a, b` },
    ]);
  });

  it("refuses a threshold that is not a number", () => {
    expect(
      duplicationFaultsIn(duplication({ threshold: "high" })).map(
        (fault) => fault.message,
      ),
    ).toEqual([`${PREFIX}/threshold must be a number`]);
  });

  it.each([0, 1.5, -1])("refuses a threshold of %s", (threshold) => {
    expect(
      duplicationFaultsIn(duplication({ threshold })).map(
        (fault) => fault.message,
      ),
    ).toEqual([`${PREFIX}/threshold must be above 0 and at most 1`]);
  });

  it("accepts a threshold of 1", () => {
    expect(duplicationFaultsIn(duplication({ threshold: 1 }))).toEqual([]);
  });

  it.each(["min_lines", "pair_min_lines", "min_nodes"])(
    "refuses %s at 0 and 1.5 and accepts it at 1",
    (key) => {
      const expected = [`${PREFIX}/${key} must be an integer of at least 1`];

      for (const value of [0, 1.5]) {
        expect(
          duplicationFaultsIn(duplication({ [key]: value })).map(
            (fault) => fault.message,
          ),
        ).toEqual(expected);
      }

      expect(duplicationFaultsIn(duplication({ [key]: 1 }))).toEqual([]);
    },
  );

  it("lists the unknown setting before a bad threshold", () => {
    expect(
      duplicationFaultsIn(duplication({ extra: 1, threshold: 1.5 })).map(
        (fault) => fault.message,
      ),
    ).toEqual([
      `${PREFIX} unknown setting: extra`,
      `${PREFIX}/threshold must be above 0 and at most 1`,
    ]);
  });

  it("finds nothing when duplication is false or absent", () => {
    expect(duplicationFaultsIn(duplication(false))).toEqual([]);
    expect(duplicationFaultsIn({ sensors: { structure: {} } })).toEqual([]);
    expect(duplicationFaultsIn({})).toEqual([]);
  });
});

describe("withMovedDuplicationSensor", () => {
  it("moves the four keys under structure", () => {
    const all = {
      threshold: 0.9,
      min_lines: 5,
      pair_min_lines: 7,
      min_nodes: 9,
    };

    expect(
      withMovedDuplicationSensor({ sensors: { duplication: all } }),
    ).toEqual({ document: duplication(all), messages: [] });
  });

  it("moves beside other structure settings", () => {
    expect(
      withMovedDuplicationSensor({
        sensors: {
          duplication: { min_lines: 5 },
          structure: { warnings: { cycle: true } },
        },
      }),
    ).toEqual({
      document: {
        sensors: {
          structure: {
            warnings: { cycle: true },
            duplication: { min_lines: 5 },
          },
        },
      },
      messages: [],
    });
  });

  it.each([
    ["empty", {}],
    ["null", null],
  ])("turns an %s entry into nothing", (_name, entry) => {
    expect(
      withMovedDuplicationSensor({ sensors: { duplication: entry } }),
    ).toEqual({ document: {}, messages: [] });
  });

  it("lets an existing structure.duplication win", () => {
    expect(
      withMovedDuplicationSensor({
        sensors: {
          duplication: { min_lines: 5 },
          structure: { duplication: { min_lines: 8 } },
        },
      }).document,
    ).toEqual(duplication({ min_lines: 8 }));
  });

  it("moves false as false", () => {
    expect(
      withMovedDuplicationSensor({ sensors: { duplication: false } }),
    ).toEqual({ document: duplication(false), messages: [] });
  });

  it("returns the message and the unchanged document for an unknown setting", () => {
    const document = { sensors: { duplication: { zed: 1, alpha: 1 } } };

    expect(withMovedDuplicationSensor(document)).toEqual({
      document,
      messages: ["config/sensors/duplication unknown setting: alpha, zed"],
    });
  });

  it("refuses a value that is neither a section nor false", () => {
    expect(
      withMovedDuplicationSensor({ sensors: { duplication: 5 } }).messages,
    ).toEqual(["config/sensors/duplication must be a section or false"]);
  });

  it("returns a document without the key untouched", () => {
    const document = { sensors: {} };

    expect(withMovedDuplicationSensor(document)).toEqual({
      document,
      messages: [],
    });
  });
});

describe("withoutFaultySensorSettings", () => {
  it("strips retired sensors and a faulty structure.duplication", () => {
    expect(
      withoutFaultySensorSettings({
        sensors: {
          duplication: {},
          "unused-exports": {},
          structure: { duplication: { threshold: 2 }, warnings: {} },
        },
      }),
    ).toEqual({ sensors: { structure: { warnings: {} } } });
  });

  it("leaves emptied sections as empty objects", () => {
    expect(withoutFaultySensorSettings(duplication({ threshold: 2 }))).toEqual({
      sensors: { structure: {} },
    });
    expect(
      withoutFaultySensorSettings({ sensors: { duplication: {} } }),
    ).toEqual({ sensors: {} });
  });

  it("keeps a valid structure.duplication", () => {
    const document = duplication({ threshold: 0.5 });

    expect(withoutFaultySensorSettings(document)).toEqual(document);
  });

  it("does not mutate its argument", () => {
    const document = { sensors: { duplication: {} } };

    withoutFaultySensorSettings(document);

    expect(document).toEqual({ sensors: { duplication: {} } });
  });
});
