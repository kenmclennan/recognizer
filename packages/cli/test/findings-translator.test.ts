import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SensorFindings } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import {
  readSensorFindings,
  sensorFindingsDocument,
} from "../src/adapters/filesystem/findings-translator.js";
import { validateFindings } from "../src/findings-document.js";

const EXAMPLES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../schema/findings-examples",
);

function example(folder: "valid" | "invalid", file: string): unknown {
  return JSON.parse(readFileSync(join(EXAMPLES, folder, file), "utf8"));
}

function valid(name: string): SensorFindings {
  return readSensorFindings(example("valid", `${name}.json`));
}

const filesOf = (found: SensorFindings) =>
  found.findings.flatMap((finding) => finding.files);

const dependenciesOf = (found: SensorFindings) =>
  found.findings.flatMap((finding) => finding.dependencies ?? []);

const membersOf = (found: SensorFindings) =>
  found.findings.flatMap((finding) => finding.members ?? []);

describe("readSensorFindings", () => {
  it("reads one finding per record with its files, members and dependencies", () => {
    const structure = valid("structure");
    const rules = dependenciesOf(structure).flatMap(
      (dependency) => dependency.rules ?? [],
    );
    const importers = structure.findings.flatMap(
      (finding) => finding.testImporters ?? [],
    );

    expect(structure.findings).toHaveLength(4);
    expect(new Set(filesOf(structure)).size).toBe(5);
    expect(dependenciesOf(structure)).toHaveLength(3);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ type: "level" });
    expect(rules[0]).toHaveProperty("fromLevel");
    expect(rules[0]).toHaveProperty("toLevel");
    expect(importers).toHaveLength(2);
    expect(membersOf(structure)).toHaveLength(0);

    const crap = valid("crap");

    expect(crap.findings).toHaveLength(2);
    expect(filesOf(crap)).toHaveLength(2);
    expect(membersOf(crap)).toHaveLength(2);

    const duplication = valid("duplication");

    expect(duplication.findings).toHaveLength(1);
    expect(filesOf(duplication)).toHaveLength(1);
    expect(membersOf(duplication)).toHaveLength(2);

    const cited = valid("citation").findings[0]?.citation;

    expect(cited).toBeDefined();
    expect(Object.keys(cited ?? {}).sort()).toEqual([
      "author",
      "locator",
      "work",
      "year",
    ]);
  });

  it("keeps the sensor's freshness and run fields", () => {
    const diagnosed = valid("diagnosis");

    expect(diagnosed.inputs).toBeDefined();
    expect(diagnosed.diagnosis?.code).toBe("tests-failed");

    const suites = valid("suites").suites ?? [];

    expect(suites).toHaveLength(4);

    for (const suite of suites) {
      expect(suite).toHaveProperty("ranAt");
      expect(suite).not.toHaveProperty("ran_at");
    }

    expect(valid("counts").counts).toEqual({ measured: 3, total: 3 });
    expect(valid("stopped").stopped).toEqual({ measured: 1, total: 3 });
    expect(valid("partial").partial).toEqual({ measured: 1, total: 3 });
    expect(valid("excluded").excluded).toEqual({
      functions: 3,
      files: ["app/rules.py"],
    });
    expect(valid("unowned").unowned).toEqual({
      functions: 3,
      files: ["app/rules.py"],
    });
    expect(valid("excluded").excluded).not.toHaveProperty("modules");
  });

  it("writes back what it read", () => {
    const names = readdirSync(join(EXAMPLES, "valid"));

    expect(names).toHaveLength(22);

    for (const name of names) {
      const document = example("valid", name);

      expect(sensorFindingsDocument(readSensorFindings(document))).toEqual(
        document,
      );
    }
  });

  it("refuses what the CLI refuses", () => {
    const names = readdirSync(join(EXAMPLES, "invalid"));

    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const document = example("invalid", name);
      let expected = "";

      try {
        validateFindings(document);
      } catch (error) {
        expected = (error as Error).message;
      }

      expect(expected).not.toBe("");
      expect(() => readSensorFindings(document)).toThrow(expected);
    }

    expect(() =>
      readSensorFindings(example("valid", "structure.json"), {
        name: "other",
      }),
    ).toThrow(/findings are from sensor/);
  });

  it("a rule of no known form is dropped", () => {
    const document = JSON.parse(
      readFileSync(join(EXAMPLES, "valid", "structure.json"), "utf8"),
    );

    document.findings[0].evidence.edges = [
      {
        from: "a.py",
        to: "b.py",
        rules: [{ type: "other" }, { type: "forbid", pattern: "a/** -> b/**" }],
      },
    ];

    const [dependency] =
      readSensorFindings(document).findings[0]?.dependencies ?? [];

    expect(dependency?.rules).toEqual([
      { type: "forbid", pattern: "a/** -> b/**" },
    ]);
  });

  it("partial resolution of members", () => {
    const document = JSON.parse(
      readFileSync(join(EXAMPLES, "valid", "crap.json"), "utf8"),
    );

    document.findings[0].evidence.members = [
      { module: "app/a.py", name: "f" },
      { module: "app/b.py", name: "g", file: "app/b.py" },
    ];

    const members = readSensorFindings(document).findings[0]?.members ?? [];

    expect(members).toHaveLength(2);
    expect(members[0]?.sourceFile).toBeUndefined();
    expect(members[0]).not.toHaveProperty("sourceFile");
    expect(members[1]?.sourceFile).toBe("app/b.py");
  });
});

describe("rule objects in a findings file", () => {
  it("reads the three forms with camelCase names", () => {
    const document = JSON.parse(
      readFileSync(join(EXAMPLES, "valid", "structure.json"), "utf8"),
    );

    document.findings[0].evidence.edges = [
      {
        from: "a",
        to: "b",
        rules: [
          { type: "level", from_level: "a", to_level: "b" },
          { type: "uses", from_component: "a", to_component: "b" },
          { type: "forbid", pattern: "x/**" },
        ],
      },
    ];

    expect(
      readSensorFindings(document).findings[0]?.dependencies?.[0]?.rules,
    ).toEqual([
      { type: "level", fromLevel: "a", toLevel: "b" },
      { type: "uses", fromComponent: "a", toComponent: "b" },
      { type: "forbid", pattern: "x/**" },
    ]);
  });
});
