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

const LABELS: Record<string, string> = {
  complexity: "cc",
  crap: "CRAP",
  coverage: "cov",
};

const cell = (
  metric: string,
  direction: "above" | "below",
  value: number,
  tone: "amber" | "red" = "amber",
) => ({
  metric,
  label: LABELS[metric],
  limit: { direction, value, tone },
});

const cellsOf = (yaml: string | null, shipped: ShippedSensors | null = REAL) =>
  (yaml === null ? functionLimits(null, shipped) : limitsOf(yaml, shipped))
    .cells;

describe("functionLimits", () => {
  it("takes the defaults from the shipped manifests when nothing is registered", () => {
    const defaults = {
      longAt: 20,
      cells: [
        cell("complexity", "above", 10),
        cell("crap", "above", 30),
        cell("coverage", "below", 0.6),
      ],
    };

    expect(functionLimits(null, REAL)).toEqual(defaults);
    expect(limitsOf("sensors: {}\n")).toEqual(defaults);
  });

  it("reads the thresholds settings", () => {
    expect(
      cellsOf(
        "sensors:\n  thresholds:\n    complexity:\n      above: 15\n    coverage: 'off'\n  crap:\n    threshold: 20\n",
      ),
    ).toEqual([
      cell("complexity", "above", 15),
      cell("crap", "above", 20),
      { metric: "coverage", label: "cov", limit: null },
    ]);
  });

  it("reads a configured complexity limit over the published figure", () => {
    expect(
      cellsOf("sensors:\n  thresholds:\n    complexity:\n      above: 12\n")[0],
    ).toEqual(cell("complexity", "above", 12));
  });

  it("reads the crap threshold", () => {
    expect(cellsOf("sensors:\n  crap:\n    threshold: 25\n")[1]).toEqual(
      cell("crap", "above", 25),
    );
  });

  it("gives a metric without a cell no entry and a configured metric with no default none", () => {
    const metrics = cellsOf(
      "sensors:\n  thresholds:\n    churn:\n      above: 20\n",
    ).map((one) => one.metric);

    expect(metrics).toEqual(["complexity", "crap", "coverage"]);
    expect(metrics).not.toContain("killed");
    expect(metrics).not.toContain("churn");
  });

  it("gives null limits and longAt 20 when the list is null or unavailable", () => {
    expect(functionLimits(null, null)).toEqual({ longAt: 20, cells: [] });
    expect(limitsOf("sensors: {}\n", null)).toEqual({
      longAt: 20,
      cells: [],
    });
    expect(
      functionLimits(null, { status: "unavailable", reason: "x" }),
    ).toEqual({ longAt: 20, cells: [] });
  });

  it("gives a null crapAt when crap declares no threshold setting", () => {
    const bare: ShippedSensors = {
      status: "ok",
      sensors: shippedSensors().map((one) =>
        one.name === "crap" ? { ...one, settings: [] } : one,
      ),
    };

    expect(cellsOf(null, bare)).toEqual([
      cell("complexity", "above", 10),
      { metric: "crap", label: "CRAP", limit: null },
      cell("coverage", "below", 0.6),
    ]);
  });

  it("falls back to null limits for unparseable settings and for config text that is not valid", () => {
    const broken = parseConfig(
      "sensors:\n  crap:\n    command: [recognizer-sensors, crap, --settings, '{nope']\n",
    );

    expect(functionLimits(broken, REAL).cells).toEqual(cellsOf(null));
    expect(limitsFromText("sensors: [", REAL)).toEqual(DEFAULT_LIMITS);
    expect(limitsFromText(null, REAL)).toEqual(functionLimits(null, REAL));
  });

  it("colours only strictly past a limit, so a value equal to it has no tone", () => {
    const [complexity, , coverage] = cellsOf(
      "sensors:\n  thresholds:\n    complexity:\n      above: 15\n    coverage:\n      below: 0.6\n",
    );

    expect(complexity?.limit?.value).toBe(15);
    expect(coverage?.limit?.value).toBe(0.6);
  });

  it("derives the tone from the severity setting", () => {
    const tones = (yaml: string) => cellsOf(yaml).map((one) => one.limit?.tone);

    expect(tones("sensors: {}\n")).toEqual(["amber", "amber", "amber"]);
    expect(
      tones(
        "sensors:\n  thresholds:\n    complexity:\n      above: 10\n      severity: violation\n",
      ),
    ).toEqual(["red", "amber", "amber"]);
    expect(
      tones(
        "sensors:\n  thresholds:\n    complexity:\n      above: 10\n      severity: warning\n",
      ),
    ).toEqual(["amber", "amber", "amber"]);
  });

  it("has the figures the thresholds sensor itself holds", () => {
    const python = readFileSync(
      join(REPO, "sensors/src/recognizer_sensors/thresholds/sensor.py"),
      "utf8",
    );
    const [complexity, , coverage] = functionLimits(null, REAL).cells;

    expect(python).toContain(`"above": ${complexity?.limit?.value},`);
    expect(python).toContain(`"below": ${coverage?.limit?.value},`);
  });
});
