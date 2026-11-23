import { beforeAll, describe, expect, it } from "vitest";
import type { Parsers } from "../src/duplication/parsers.js";
import { parsePolicy } from "../src/policy.js";
import { runStructureSensor } from "../src/structure-run.js";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  resolveStructureSettings,
  type StructureSettings,
} from "../src/structure-sensor.js";
import { allParsers, measuredSources, ROOT } from "./duplication-helpers.js";

let parsers: Parsers;

beforeAll(async () => {
  parsers = await allParsers();
});

function branches(name: string, count: number, extra = ""): string {
  const body = Array.from(
    { length: count },
    (_, index) => `    if x == ${index}:\n        y = ${index}`,
  ).join("\n");

  return `def ${name}(x):\n    y = 0\n${body}\n${extra}    return y\n`;
}

function sense(
  files: Record<string, string>,
  overrides: Partial<StructureSettings> = {},
  policyText: string | null = null,
) {
  const { fake, scans } = measuredSources(files);
  const settings: StructureSettings = {
    ...DEFAULT_STRUCTURE_SETTINGS,
    duplication: false,
    ...overrides,
  };
  const run = runStructureSensor(
    fake.io,
    ROOT,
    scans,
    policyText === null ? null : parsePolicy(policyText),
    settings,
    parsers,
  );

  return {
    run,
    findings: run.sensed.document.findings.filter(
      (finding) => finding.kind === "complexity",
    ),
  };
}

describe("the complexity warning", () => {
  it("gives a function at the limit none and one above it exactly one", () => {
    const { findings, run } = sense({
      "a.py": `${branches("at_limit", 9)}\n${branches("above", 10)}`,
    });

    expect(run.error).toBeNull();
    expect(findings.map((finding) => finding.id)).toEqual([
      "complexity:a.py::above",
    ]);
  });

  it("carries the binding shape and the principle's citation", () => {
    const { findings } = sense({ "a.py": branches("f", 10) });
    const [finding] = findings;

    expect(finding).toMatchObject({
      id: "complexity:a.py::f",
      kind: "complexity",
      severity: "warning",
      principle: "cyclomatic-complexity-limit",
      summary: "f has complexity 11, over the limit of 10",
      files: ["a.py"],
      members: [{ file: "a.py", name: "f", sourceFile: "a.py" }],
      measures: { complexity: 11, limit: 10 },
    });
    expect(finding?.citation).toMatchObject({
      author: "Thomas J. McCabe",
      year: 1976,
    });
    expect(finding?.measures).not.toHaveProperty("published");
  });

  it("names both figures when the limit is tuned and keeps the citation", () => {
    const { findings } = sense(
      { "a.py": `${branches("eleven", 10)}\n${branches("thirteen", 12)}` },
      { complexity_limit: 12 },
    );

    expect(findings.map((finding) => finding.id)).toEqual([
      "complexity:a.py::thirteen",
    ]);
    expect(findings[0]?.measures).toEqual({
      complexity: 13,
      limit: 12,
      published: 10,
    });
    expect(findings[0]?.summary).toBe(
      "thirteen has complexity 13, over the limit of 12",
    );
    expect(findings[0]?.citation?.year).toBe(1976);
  });

  it("reports nothing when the warning is switched off", () => {
    const { findings, run } = sense(
      { "a.py": branches("f", 20) },
      {
        warnings: { ...DEFAULT_STRUCTURE_SETTINGS.warnings, complexity: false },
      },
    );

    expect(findings).toEqual([]);
    expect(run.sensed.document.settings.complexity_limit).toBeUndefined();
  });

  it("skips an ignored module and a test file but not their sibling", () => {
    const { findings } = sense(
      {
        "ignored/a.py": branches("f", 12),
        "test_x.py": branches("g", 12),
        "kept.py": branches("h", 12),
      },
      {},
      "ignore: ['ignored/**']\n",
    );

    expect(findings.map((finding) => finding.id)).toEqual([
      "complexity:kept.py::h",
    ]);
  });

  it("tells two functions of one name in a file apart by start line", () => {
    const { findings } = sense({
      "a.py": `${branches("f", 10)}\n${branches("f", 11)}`,
    });

    expect(findings.map((finding) => finding.id)).toEqual([
      "complexity:a.py::f@1",
      "complexity:a.py::f@25",
    ]);
  });

  it("keeps a nested function's branches out of its outer function", () => {
    const inner = Array.from(
      { length: 10 },
      (_, index) => `        if x == ${index}:\n            y = ${index}`,
    ).join("\n");
    const outer = Array.from(
      { length: 10 },
      (_, index) => `    if x == ${index}:\n        y = ${index}`,
    ).join("\n");
    const source = `def outer(x):\n    y = 0\n${outer}\n    def inner(x):\n        y = 0\n${inner}\n        return y\n    return y\n`;
    const { findings } = sense({ "a.py": source });

    expect(
      findings.map((finding) => [finding.id, finding.measures?.complexity]),
    ).toEqual([
      ["complexity:a.py::outer", 11],
      ["complexity:a.py::outer.inner", 11],
    ]);
  });

  it("drops the outer function too when a nested one has a syntax error, as C.R.A.P. does", () => {
    const outer = Array.from(
      { length: 10 },
      (_, index) => `    if x == ${index}:\n        y = ${index}`,
    ).join("\n");
    const source = `def outer(x):\n    y = 0\n${outer}\n    def broken(x:\n        if x:\n            return 1\n    return y\n`;
    const { findings } = sense({ "a.py": source });

    expect(findings).toEqual([]);
  });

  it("gives a function with a syntax error in its own body none", () => {
    const body = Array.from(
      { length: 12 },
      (_, index) => `    if x == ${index}:\n        y = ${index}`,
    ).join("\n");
    const { findings } = sense({
      "a.py": `def f(x:\n    y = 0\n${body}\n    return y\n`,
    });

    expect(findings).toEqual([]);
  });

  it("measures with no sensor and no overlay and writes the limit it judged by", () => {
    const { run } = sense({ "a.py": branches("f", 10) });

    expect(run.sensed.document.settings.complexity_limit).toBe(10);
    expect(run.sensed.document.settings.warnings).toMatchObject({
      complexity: true,
    });
  });
});

describe("a failure in one measure", () => {
  it("leaves duplication's findings and names complexity in the error", () => {
    const { fake, scans } = measuredSources({ "a.py": branches("f", 10) });
    const partial = new Map(
      [...parsers].filter(([grammar]) => grammar !== "python"),
    );
    const run = runStructureSensor(
      fake.io,
      ROOT,
      scans,
      null,
      DEFAULT_STRUCTURE_SETTINGS,
      partial,
    );

    expect(run.error).toMatch(/^complexity: /);
    expect(
      run.sensed.document.findings.some(
        (finding) => finding.kind === "complexity",
      ),
    ).toBe(false);
    expect(run.sensed.document.settings.duplication).toBeDefined();
  });

  it("leaves complexity's findings when duplication fails", () => {
    const { fake, scans } = measuredSources({ "a.py": branches("f", 10) });
    const failing = {
      ...fake.io,
      readBytes: (path: string) => {
        if (new Error().stack?.includes("collectUnits")) {
          throw new Error("boom");
        }

        return fake.io.readBytes(path);
      },
    };
    const run = runStructureSensor(
      failing,
      ROOT,
      scans,
      null,
      DEFAULT_STRUCTURE_SETTINGS,
      parsers,
    );

    expect(
      run.sensed.document.findings.some(
        (finding) => finding.kind === "complexity",
      ),
    ).toBe(true);
  });
});

describe("the structure settings", () => {
  it("resolve the complexity switch and limit like long_function", () => {
    const resolve = (text: string) => {
      const config = {
        sensors: { structure: JSON.parse(text) },
      } as Parameters<typeof resolveStructureSettings>[0];

      return resolveStructureSettings(config) as StructureSettings;
    };

    expect(resolve("{}").complexity_limit).toBe(10);
    expect(resolve("{}").warnings.complexity).toBe(true);
    expect(
      resolve('{"warnings":{"complexity":{"limit":15}}}').complexity_limit,
    ).toBe(15);
    expect(
      resolve('{"warnings":{"complexity":false}}').warnings.complexity,
    ).toBe(false);
  });
});
