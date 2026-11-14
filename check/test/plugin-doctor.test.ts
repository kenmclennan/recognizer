import { describe, expect, it } from "vitest";
import {
  buildReport,
  type DoctorFacts,
  reportJson,
  reportText,
} from "../src/doctor.js";
import type { PluginFact, PluginSpec } from "../src/plugin-doctor.js";
import { scannerProblems, settingProblems } from "../src/plugin-doctor.js";
import type { Manifest } from "../src/plugin-manifest.js";
import { manifestFor } from "./plugin-path.js";

const CONFIG = "sensors:\n  mine:\n    command: [recognizer-sense-mine, run]\n";

function facts(overrides: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    repository: "/repo",
    named: false,
    configText: CONFIG,
    policyText: null,
    languages: [],
    scans: () => ({ state: "missing" }),
    shipped: { sensors: [], describer: false },
    scanners: [
      {
        kind: "scanner",
        name: "python",
        command: "/bin/recognizer-scan-python",
        judgement: "current",
        manifest: manifestFor("scanner", "python") as unknown as Manifest,
      },
    ],
    plugins: (specs: PluginSpec[]): PluginFact[] =>
      specs.map((spec) => ({
        ...spec,
        state: {
          status: "read",
          manifest: manifestFor("sensor", "mine", {
            protocol: 1,
          }) as unknown as Manifest,
          judgement: "previous",
          gaps: null,
        },
      })),
    ...overrides,
  };
}

describe("doctor: a plugin on the previous protocol", () => {
  it("is a warning, so the report is ok", () => {
    const report = buildReport(facts());
    const sensors = report.areas.find((one) => one.name === "sensors");

    expect(report.ok).toBe(true);
    expect(report.problems).toBe(0);
    expect(report.warnings).toBe(1);
    expect(sensors?.problems[0]).toMatchObject({
      code: "plugin-protocol",
      severity: "warning",
    });
  });

  it("prints the warning count after the problem count", () => {
    const text = reportText(buildReport(facts()));

    expect(text).toMatch(/warning: .*previous protocol/);
    expect(text.trimEnd().endsWith("No problems\n1 warning")).toBe(true);
  });

  it("carries warnings and each problem's severity in --json", () => {
    const document = JSON.parse(reportJson(buildReport(facts())));

    expect(document.warnings).toBe(1);
    expect(document.areas[3].problems[0].severity).toBe("warning");
  });
});

describe("scannerProblems", () => {
  it("reports a previous-protocol scanner as a warning with its install line", () => {
    const scanner = {
      kind: "scanner" as const,
      name: "python",
      command: "/bin/recognizer-scan-python",
      judgement: "previous" as const,
      manifest: manifestFor("scanner", "python", {
        protocol: 1,
        install: "get it",
        languages: [
          {
            name: "python",
            extensions: [".py"],
            files: [],
            skip: {},
          },
        ],
      }) as unknown as Manifest,
    };
    const [problem] = scannerProblems(
      ["python"],
      [scanner],
      {},
      {
        "recognizer-scan-python": "recorded line",
      },
    );

    expect(problem).toMatchObject({
      code: "plugin-protocol",
      severity: "warning",
    });
    expect(problem?.fix.text).toBe("recorded line");
  });
});

describe("settingProblems", () => {
  const declared = [
    { key: "threshold", type: "number", exclusiveMinimum: 0 },
    { key: "mode", type: "enum", values: ["a", "b"] },
    { key: "limit", type: "integer", minimum: 1, maximum: 5 },
    { key: "on", type: "boolean" },
    { key: "<metric>.above", type: "number" },
  ];

  it.each([
    [{ threshold: 0 }, "threshold"],
    [{ threshold: "x" }, "threshold"],
    [{ mode: "c" }, "mode"],
    [{ limit: 6 }, "limit"],
    [{ limit: 0 }, "limit"],
    [{ limit: 1.5 }, "limit"],
    [{ on: "yes" }, "on"],
    [{ unknown: 1 }, "unknown"],
    [{ complexity: { below: 1 } }, "complexity.below"],
  ])("reports %j naming %s", (settings, key) => {
    const found = settingProblems("s", settings, declared);

    expect(found).toHaveLength(1);
    expect(found[0]?.line).toContain(key);
  });

  it.each([
    { threshold: 0.5 },
    { mode: "a" },
    { limit: 5 },
    { on: false },
    { complexity: { above: 3 }, size: { above: 9 } },
  ])("accepts %j", (settings) => {
    expect(settingProblems("s", settings, declared)).toEqual([]);
  });
});
