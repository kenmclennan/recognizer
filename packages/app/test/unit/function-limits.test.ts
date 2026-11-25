import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPLEXITY_LIMIT, parseConfig } from "recognizer";
import { describe, expect, it } from "vitest";
import { functionLimits } from "../../src/function-limits";
import { installedSensors } from "../../src/installed-fake";
import type { InstalledSensors } from "../../src/sensor-run";

const srcUrl = new URL("../../src/index.ts", import.meta.url).href;

const REPO = resolve(dirname(fileURLToPath(srcUrl)), "../../..");

const REAL: InstalledSensors = { status: "ok", sensors: installedSensors() };

const limitsOf = (yaml: string, installed: InstalledSensors | null = REAL) =>
  functionLimits(parseConfig(yaml), installed);

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

const cellsOf = (
  yaml: string | null,
  installed: InstalledSensors | null = REAL,
) =>
  (yaml === null ? functionLimits(null, installed) : limitsOf(yaml, installed))
    .cells;

describe("functionLimits", () => {
  it("takes the defaults from the installed manifests when nothing is registered", () => {
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

  it("reads the coverage limit", () => {
    expect(
      cellsOf(
        "sensors:\n  structure:\n    warnings:\n      complexity:\n        limit: 15\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n    threshold: 20\n    coverage_limit: false\n",
      ),
    ).toEqual([
      cell("complexity", "above", 15),
      cell("crap", "above", 20),
      { metric: "coverage", label: "cov", limit: null },
    ]);
    expect(
      cellsOf(
        "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n    coverage_limit: 0.7\n",
      )[2],
    ).toEqual(cell("coverage", "below", 0.7));
  });

  it("reads a configured complexity limit over the published figure", () => {
    expect(
      cellsOf(
        "sensors:\n  structure:\n    warnings:\n      complexity:\n        limit: 12\n",
      )[0],
    ).toEqual(cell("complexity", "above", 12));
  });

  it("reads the crap threshold", () => {
    expect(
      cellsOf(
        "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n    threshold: 25\n",
      )[1],
    ).toEqual(cell("crap", "above", 25));
  });

  it("gives a metric without a cell no entry and a configured metric with no default none", () => {
    const metrics = cellsOf("sensors:\n  mutation:\n    max_workers: 2\n").map(
      (one) => one.metric,
    );

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
    const bare: InstalledSensors = {
      status: "ok",
      sensors: installedSensors().map((one) =>
        one.name === "crap" ? { ...one, settings: [] } : one,
      ),
    };

    expect(cellsOf(null, bare)).toEqual([
      cell("complexity", "above", 10),
      { metric: "crap", label: "CRAP", limit: null },
      { metric: "coverage", label: "cov", limit: null },
    ]);
  });

  it("falls back to null limits for unparseable settings and for config text that is not valid", () => {
    const broken = parseConfig(
      "sensors:\n  crap:\n    command: [recognizer-sense-crap, --settings, '{nope']\n",
    );

    expect(functionLimits(broken, REAL).cells).toEqual(cellsOf(null));
  });

  it("colours only strictly past a limit, so a value equal to it has no tone", () => {
    const [complexity, , coverage] = cellsOf(
      "sensors:\n  structure:\n    warnings:\n      complexity:\n        limit: 15\n  crap:\n    coverage_limit: 0.6\n",
    );

    expect(complexity?.limit?.value).toBe(15);
    expect(coverage?.limit?.value).toBe(0.6);
  });

  it("derives the tone from the severity setting", () => {
    const tones = (yaml: string) => cellsOf(yaml).map((one) => one.limit?.tone);

    expect(tones("sensors: {}\n")).toEqual(["amber", "amber", "amber"]);
    expect(
      tones(
        "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n    coverage_limit: 0.7\n",
      ),
    ).toEqual(["amber", "amber", "amber"]);
  });

  it("has the coverage figure the crap sensor itself holds", () => {
    const python = readFileSync(
      join(REPO, "packages/sensors/src/recognizer_sensors/crap/sensor.py"),
      "utf8",
    );
    const [complexity, , coverage] = functionLimits(null, REAL).cells;

    expect(complexity?.limit?.value).toBe(COMPLEXITY_LIMIT);
    expect(python).toContain(`"coverage_limit": ${coverage?.limit?.value},`);
  });
});

describe("the complexity cell's limit", () => {
  const complexityOf = (yaml: string) =>
    cellsOf(yaml).find((one) => one.metric === "complexity")?.limit;

  it("is 10 by default and the configured limit under the structure sensor", () => {
    expect(complexityOf("sensors: {}\n")?.value).toBe(10);
    expect(
      complexityOf(
        "sensors:\n  structure:\n    warnings:\n      complexity:\n        limit: 12\n",
      )?.value,
    ).toBe(12);
  });

  it("has no limit when the complexity warning is switched off", () => {
    expect(
      complexityOf(
        "sensors:\n  structure:\n    warnings:\n      complexity: false\n",
      ),
    ).toBeNull();
  });

  it("reads the coverage cell from the crap sensor", () => {
    const coverage = cellsOf(
      "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n    coverage_limit: 0.7\n",
    ).find((one) => one.metric === "coverage");

    expect(coverage?.limit?.value).toBe(0.7);
  });
});
