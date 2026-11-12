import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { CORE_KEYS } from "../src/config-keys.js";
import { parseConfig } from "../src/config-parse.js";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  resolveStructureSettings,
} from "../src/structure-sensor.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

const CONFIG = `${ROOT}/.recognizer/config.yaml`;
const MESSAGE =
  "config/sensors/duplication was removed: duplication is now part of the structure sensor and runs with every scan; move its settings to sensors.structure.duplication (threshold, min_lines, pair_min_lines, min_nodes), or set sensors.structure.duplication to false to switch it off, and delete the sensors.duplication key";

function resolved(text: string) {
  return resolveStructureSettings(parseConfig(text));
}

function refusal(text: string): string {
  try {
    parseConfig(text);
  } catch (error) {
    return (error as Error).message;
  }

  return "";
}

describe("the structure duplication settings", () => {
  it("default to the sensor's own defaults", () => {
    expect(resolved("")).toEqual(DEFAULT_STRUCTURE_SETTINGS);
    expect((resolved("") as { duplication: unknown }).duplication).toEqual({
      threshold: 0.82,
      min_lines: 4,
      pair_min_lines: 6,
      min_nodes: 20,
    });
  });

  it("take each key's override and keep the other defaults", () => {
    const text = (key: string, value: string) =>
      `sensors:\n  structure:\n    duplication:\n      ${key}: ${value}\n`;

    expect(resolved(text("threshold", "0.9"))).toMatchObject({
      duplication: {
        threshold: 0.9,
        min_lines: 4,
        pair_min_lines: 6,
        min_nodes: 20,
      },
    });
    expect(resolved(text("min_lines", "6"))).toMatchObject({
      duplication: { threshold: 0.82, min_lines: 6 },
    });
    expect(resolved(text("pair_min_lines", "8"))).toMatchObject({
      duplication: { pair_min_lines: 8 },
    });
    expect(resolved(text("min_nodes", "30"))).toMatchObject({
      duplication: { min_nodes: 30 },
    });
  });

  it("switch off with false and with the whole structure sensor", () => {
    expect(
      resolved("sensors:\n  structure:\n    duplication: false\n"),
    ).toMatchObject({ duplication: false });
    expect(resolved("sensors:\n  structure: off\n")).toBe("off");
  });

  it.each([
    ["threshold: 0", "threshold must be above 0 and at most 1"],
    ["threshold: 1.5", "threshold must be above 0 and at most 1"],
    ["threshold: true", "threshold must be a number"],
    ["min_lines: 0", "min_lines must be an integer of at least 1"],
    ["min_lines: 1.5", "min_lines must be an integer of at least 1"],
    ["pair_min_lines: 0", "pair_min_lines must be an integer of at least 1"],
    ["min_nodes: 0", "min_nodes must be an integer of at least 1"],
    ["nonesuch: 1", "unknown setting: nonesuch"],
  ])("refuse %s with the Python message", (line, message) => {
    expect(
      refusal(`sensors:\n  structure:\n    duplication:\n      ${line}\n`),
    ).toContain(message);
  });

  it("refuse the retired sensor in every form, before any schema message", () => {
    expect(refusal("sensors:\n  duplication: {}\n")).toBe(MESSAGE);
    expect(refusal("sensors:\n  duplication:\n    threshold: 0.9\n")).toBe(
      MESSAGE,
    );
    expect(refusal("sensors:\n  duplication:\n    command: [mine]\n")).toBe(
      MESSAGE,
    );
    expect(refusal("sensors:\n  duplication:\n    threshold: 7\n")).toBe(
      MESSAGE,
    );
  });

  it("write and unset through recognizer config", () => {
    const fake = fakeIo();

    expect(
      run(
        [
          "config",
          "--repository",
          ROOT,
          "sensors.structure.duplication.threshold",
          "0.9",
        ],
        fake.io,
      ),
    ).toBe(0);
    expect(fake.files.get(CONFIG)).toBe(
      "sensors:\n  structure:\n    duplication:\n      threshold: 0.9\n",
    );
    expect(
      run(
        [
          "config",
          "--repository",
          ROOT,
          "--unset",
          "sensors.structure.duplication.threshold",
        ],
        fake.io,
      ),
    ).toBe(0);
    expect(fake.files.get(CONFIG) ?? "").not.toContain("threshold");
  });

  it("list the four keys and the switch", () => {
    const names = CORE_KEYS.keys.map((entry) => entry.key);

    expect(names).toEqual(
      expect.arrayContaining([
        "sensors.structure.duplication",
        "sensors.structure.duplication.threshold",
        "sensors.structure.duplication.min_lines",
        "sensors.structure.duplication.pair_min_lines",
        "sensors.structure.duplication.min_nodes",
      ]),
    );
  });
});
