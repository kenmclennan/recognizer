import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  functionLimits,
  limitsFromText,
} from "./function-limits";
import type { ShippedSensors } from "./sensor-run";
import { shippedSensors } from "./shipped-fake";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const REAL: ShippedSensors = { status: "ok", sensors: shippedSensors() };

const limitsOf = (yaml: string, shipped: ShippedSensors | null = REAL) =>
  functionLimits(parseConfig(yaml), shipped);

describe("the long-function limit", () => {
  it("follows the structure sensor's limit and falls back to 20", () => {
    const longAt = (yaml: string) => limitsOf(yaml).longAt;

    expect(
      longAt(
        "sensors:\n  structure:\n    warnings:\n      long_function:\n        limit: 30\n",
      ),
    ).toBe(30);
    expect(longAt("sensors: {}\n")).toBe(20);
    expect(
      longAt(
        "sensors:\n  structure:\n    warnings:\n      long_function: false\n",
      ),
    ).toBe(20);
    expect(longAt("sensors:\n  structure: 'off'\n")).toBe(20);
  });

  it("is 20 whatever the list says", () => {
    expect(limitsOf("sensors: {}\n", null).longAt).toBe(20);
  });
});

describe("functionLimits", () => {
  it("takes the defaults from the shipped manifests when nothing is registered", () => {
    const defaults = {
      complexityAbove: 10,
      coverageBelow: 0.6,
      crapAt: 30,
      longAt: 20,
    };

    expect(functionLimits(null, REAL)).toEqual(defaults);
    expect(limitsOf("sensors: {}\n")).toEqual(defaults);
  });

  it("reads the thresholds settings", () => {
    expect(
      limitsOf(
        "sensors:\n  thresholds:\n    complexity:\n      above: 12\n    coverage: 'off'\n",
      ),
    ).toEqual({
      complexityAbove: 12,
      coverageBelow: null,
      crapAt: 30,
      longAt: 20,
    });
  });

  it("reads a configured complexity limit over the published figure", () => {
    expect(
      limitsOf("sensors:\n  thresholds:\n    complexity:\n      above: 12\n")
        .complexityAbove,
    ).toBe(12);
  });

  it("reads the crap threshold", () => {
    expect(limitsOf("sensors:\n  crap:\n    threshold: 25\n").crapAt).toBe(25);
  });

  it("gives null limits and longAt 20 when the list is null or unavailable", () => {
    const empty = {
      complexityAbove: null,
      coverageBelow: null,
      crapAt: null,
      longAt: 20,
    };

    expect(functionLimits(null, null)).toEqual(empty);
    expect(limitsOf("sensors: {}\n", null)).toEqual(empty);
    expect(
      functionLimits(null, { status: "unavailable", reason: "x" }),
    ).toEqual(empty);
  });

  it("gives a null crapAt when crap declares no threshold setting", () => {
    const bare: ShippedSensors = {
      status: "ok",
      sensors: shippedSensors().map((one) =>
        one.name === "crap" ? { ...one, settings: [] } : one,
      ),
    };

    expect(functionLimits(null, bare).crapAt).toBeNull();
    expect(functionLimits(null, bare).complexityAbove).toBe(10);
  });

  it("falls back to null limits for unparseable settings and for config text that is not valid", () => {
    const broken = parseConfig(
      "sensors:\n  crap:\n    command: [recognizer-sensors, crap, --settings, '{nope']\n",
    );

    expect(functionLimits(broken, REAL)).toEqual({
      ...DEFAULT_LIMITS,
      complexityAbove: 10,
      coverageBelow: 0.6,
      crapAt: 30,
    });
    expect(limitsFromText("sensors: [", REAL)).toEqual(DEFAULT_LIMITS);
    expect(limitsFromText(null, REAL)).toEqual({
      complexityAbove: 10,
      coverageBelow: 0.6,
      crapAt: 30,
      longAt: 20,
    });
  });

  it("has the figures the thresholds sensor itself holds", () => {
    const python = readFileSync(
      join(REPO, "sensors/src/recognizer_sensors/thresholds/sensor.py"),
      "utf8",
    );
    const limits = functionLimits(null, REAL);

    expect(python).toContain(`"above": ${limits.complexityAbove},`);
    expect(python).toContain(`"below": ${limits.coverageBelow},`);
  });
});
