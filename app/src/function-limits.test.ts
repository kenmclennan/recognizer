import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  COMPLEXITY_ABOVE,
  COVERAGE_BELOW,
  CRAP_AT,
  DEFAULT_LIMITS,
  functionLimits,
  limitsFromText,
} from "./function-limits";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const limitsOf = (yaml: string) => functionLimits(parseConfig(yaml));

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
});

describe("functionLimits", () => {
  it("falls back to the named defaults when nothing is registered", () => {
    expect(functionLimits(null)).toEqual(DEFAULT_LIMITS);
    expect(limitsOf("sensors: {}\n")).toEqual(DEFAULT_LIMITS);
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

  it("reads the crap threshold", () => {
    expect(limitsOf("sensors:\n  crap:\n    threshold: 25\n").crapAt).toBe(25);
  });

  it("falls back for unparseable settings and for config text that is not valid", () => {
    const broken = parseConfig(
      "sensors:\n  crap:\n    command: [recognizer-sensors, crap, --settings, '{nope']\n",
    );

    expect(functionLimits(broken)).toEqual(DEFAULT_LIMITS);
    expect(limitsFromText("sensors: [")).toEqual(DEFAULT_LIMITS);
    expect(limitsFromText(null)).toEqual(DEFAULT_LIMITS);
  });

  it("has the defaults the shipped sensors use", () => {
    const crap = JSON.parse(
      readFileSync(
        join(REPO, "schema/manifest-examples/valid/sensor-crap.json"),
        "utf8",
      ),
    ) as { settings: { key: string; default?: number }[] };
    const python = readFileSync(
      join(REPO, "sensors/src/recognizer_sensors/thresholds/sensor.py"),
      "utf8",
    );

    expect(crap.settings.find((one) => one.key === "threshold")?.default).toBe(
      CRAP_AT,
    );
    expect(python).toContain(`"above": ${COMPLEXITY_ABOVE},`);
    expect(python).toContain(`"below": ${COVERAGE_BELOW},`);
  });
});
