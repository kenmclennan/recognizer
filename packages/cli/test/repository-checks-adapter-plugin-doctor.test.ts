import {
  buildReport as build,
  type CachedScansState,
  type InstalledPlugin,
  type Manifest,
  type PluginFact,
  type PluginSpec,
  type PolicyParse,
  type PublishedValues,
  type RepositoryChecks,
  readConfigArea,
  readPolicyArea,
  scannerProblems as scannerProblemsOf,
  settingProblems,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parsePolicy } from "../src/adapters/filesystem/policy-translator.js";
import { schemaMessages } from "../src/config-parse.js";
import { reportJson, reportText } from "../src/doctor.js";
import { InputError } from "../src/errors.js";
import { documentValidators } from "../src/manifest-ports.js";
import { manifestFor } from "./plugin-path.js";

type DoctorFacts = Context & {
  testsUnrun: { name: string; display?: string }[];
  scanners: InstalledPlugin[];
  plugins(specs: PluginSpec[]): PluginFact[];
};

interface Context {
  repository: string;
  named: boolean;
  configText: string | null;
  policyText: string | null;
  languages: string[];
  scans(): CachedScansState;
}

function repositoryChecksOf(
  given: Context,
  keys: PublishedValues,
): RepositoryChecks {
  return {
    isDirectory: () => true,
    languages: () => given.languages,
    configDocument: () =>
      given.configText === null
        ? { kind: "absent" }
        : { kind: "parsed", document: parse(given.configText) ?? {} },
    configSchemaMessages: (document) => schemaMessages(document),
    publishedKeys: () => keys,
    policyFacts: () => {
      if (given.policyText === null) {
        return { kind: "absent" };
      }

      const text = given.policyText;
      const document: unknown = parse(text);

      return {
        kind: "read",
        keys:
          typeof document === "object" && document !== null
            ? Object.keys(document)
            : [],
        parsed: parsedPolicy(text),
      };
    },
    scansState: () => given.scans(),
    registeredSensors: () => [],
    suites: () => undefined,
  };
}

function parsedPolicy(text: string): PolicyParse {
  try {
    return { ok: true, rules: parsePolicy(text) };
  } catch (error) {
    return {
      ok: false,
      messages:
        error instanceof InputError
          ? error.messages
          : [(error as Error).message],
    };
  }
}

function buildReport(given: DoctorFacts) {
  const repository = repositoryChecksOf(given, []);
  const config = readConfigArea(repository, given.repository, given.named);

  return build({
    repository: given.repository,
    configProblems: config.problems,
    registered: config.registered,
    policyProblems: readPolicyArea(
      repository,
      given.repository,
      given.named,
      given.languages,
    ),
    languages: given.languages,
    scanners: given.scanners,
    plugins: given.plugins,
    testsUnrun: given.testsUnrun,
    protocol: documentValidators.facts,
  });
}

const scannerProblems = (
  languages: readonly string[],
  scanners: readonly InstalledPlugin[],
  named: Record<string, string>,
  install: Record<string, string>,
) =>
  scannerProblemsOf(
    languages,
    scanners,
    named,
    install,
    documentValidators.facts,
  );

const CONFIG =
  "sensors:\n  mine:\n    command: [recognizer-sense-mine, run]\n    manifest: [recognizer-sense-mine, manifest]\n";

function facts(overrides: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    repository: "/repo",
    named: false,
    configText: CONFIG,
    policyText: null,
    languages: [],
    scans: () => ({ state: "missing" }),
    testsUnrun: [],
    scanners: [
      {
        kind: "scanner",
        name: "python",
        command: "/bin/recognizer-scan-python",
        judgement: "current",
        schema: "undeclared",
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

describe("scannerProblems and the scan schema", () => {
  function scanner(schema: InstalledPlugin["schema"], declared?: number) {
    return {
      kind: "scanner" as const,
      name: "python",
      command: "/bin/recognizer-scan-python",
      judgement: "current" as const,
      schema,
      manifest: manifestFor("scanner", "python", {
        install: "get it",
        scan_schema_version: declared,
        languages: [
          { name: "python", extensions: [".py"], files: [], skip: {} },
        ],
      }) as unknown as Manifest,
    };
  }

  it("gives a newer scanner the cask fix", () => {
    const found = scannerProblems(["python"], [scanner("newer", 8)], {}, {});

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: "plugin-scan-schema",
      severity: "problem",
    });
    expect(found[0]?.fix.text).toBe(
      "brew upgrade --cask kenmclennan/tap/recognizer",
    );
  });

  it("gives a broken scanner its recorded install line", () => {
    const found = scannerProblems(
      ["python"],
      [scanner("broken", 6)],
      {},
      { "recognizer-scan-python": "recorded line" },
    );

    expect(found[0]?.fix.text).toBe("recorded line");
    expect(found[0]?.line).toContain("recorded line");
  });

  it.each(["older", "undeclared", "current"] as const)(
    "raises nothing for a %s scanner",
    (schema) => {
      expect(scannerProblems(["python"], [scanner(schema, 7)], {}, {})).toEqual(
        [],
      );
    },
  );
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
