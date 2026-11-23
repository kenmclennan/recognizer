import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseBaseline,
  serialiseBaseline,
  violationId,
} from "../src/baseline.js";
import { rankAgainstBaseline } from "../src/check.js";
import { validateFindings } from "../src/findings-document.js";
import {
  collectViolations,
  parsePolicy,
  principleOf,
  validateScan,
} from "../src/index.js";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  measuredInputs,
  measuredModules,
  structureSensor,
} from "../src/structure-sensor.js";
import { REPO } from "./helpers.js";
import { repositoryFrom } from "./repository-from.js";

const EXAMPLES = join(REPO, "schema/findings-examples");
const CONTEXT = { commit: "abc", modified: false };

function fixture(name: string) {
  const dir = join(REPO, "fixtures", name);
  const read = (path: string) => readFileSync(join(dir, path), "utf8");

  return {
    scan: repositoryFrom(validateScan(JSON.parse(read("scan.json")))),
    policy: parsePolicy(read(".recognizer/policy.yaml")),
    baselineText: read(".recognizer/baselines/violations.json"),
    expected: (file: string) => JSON.parse(read(file)),
  };
}

function sense(name: string, cycle = true) {
  const { scan, policy } = fixture(name);

  return structureSensor(
    scan,
    policy,
    {
      entry_points: [],
      entry_annotations: [],
      warnings: {
        cycle,
        orphan: cycle,
        unused_exports: false,
        private_imports: true,
        long_function: true,
      },
    },
    CONTEXT,
  );
}

describe("findings schema examples", () => {
  it.each(readdirSync(join(EXAMPLES, "valid")))("accepts %s", (file) => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "valid", file), "utf8"),
    );

    expect(() => validateFindings(value)).not.toThrow();
  });

  it.each(readdirSync(join(EXAMPLES, "invalid")))("rejects %s", (file) => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "invalid", file), "utf8"),
    );

    expect(() => validateFindings(value)).toThrow();
  });

  it("rejects a record whose evidence carries used_by, which only that property makes invalid", () => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "valid/structure.json"), "utf8"),
    );

    value.findings[0].evidence = {
      modules: ["a.py"],
      used_by: [{ module: "b.py", names: [] }],
    };

    expect(() => validateFindings(value)).toThrow(/additional properties/);

    delete value.findings[0].evidence.used_by;

    expect(() => validateFindings(value)).not.toThrow();
  });

  it("rejects a document from another sensor or commit when told what to expect", () => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "valid/empty.json"), "utf8"),
    );

    expect(() => validateFindings(value, { name: "other" })).toThrow(/sensor/);
    expect(() => validateFindings(value, { commit: "zzz" })).toThrow(/commit/);
  });
});

describe("structureSensor ids", () => {
  it("gives the same ids for the same evidence on every run", () => {
    const first = sense("check-warnings").document.findings.map((f) => f.id);
    const second = sense("check-warnings").document.findings.map((f) => f.id);

    expect(second).toEqual(first);
  });

  it("gives the same cycle ids when the scans are reordered", () => {
    const { scan, policy } = fixture("check-warnings");
    const other = { ...scan, files: [...scan.files].reverse() };
    const ids = (scans: typeof scan) =>
      structureSensor(scans, policy, DEFAULT_STRUCTURE_SETTINGS, CONTEXT)
        .document.findings.filter((f) => f.kind === "cycle")
        .map((f) => f.id);

    expect(ids(other)).toEqual(ids(scan));
  });

  it("records the current sensor version", () => {
    expect(sense("check-warnings").document.sensor.version).toBe("23");
  });

  it("changes only orphan findings when the scan carries test imports", () => {
    const { scan, policy } = fixture("check-warnings");
    const orphan = sense("check-warnings").document.findings.find(
      (f) => f.kind === "orphan",
    );
    const to = orphan?.evidence.modules[0] as string;
    const withTests = {
      ...scan,
      testImports: [{ from: "tests/test_x.py", to }],
    };
    const run = (scans: typeof scan) =>
      structureSensor(scans, policy, DEFAULT_STRUCTURE_SETTINGS, CONTEXT)
        .document.findings;
    const other = (findings: ReturnType<typeof run>) =>
      findings.filter((f) => f.kind !== "orphan");

    expect(other(run(withTests))).toEqual(other(run(scan)));
    expect(
      run(withTests)
        .filter((f) => f.kind === "orphan")
        .map((f) => f.id),
    ).toEqual(
      run(scan)
        .filter((f) => f.kind === "orphan")
        .map((f) => f.id),
    );
    expect(run(withTests).find((f) => f.id === orphan?.id)?.fix_pattern).toBe(
      "move-orphan-to-tests",
    );
  });

  it("produces a document that validates against the schema", () => {
    expect(() =>
      validateFindings(sense("check").document, { name: "structure" }),
    ).not.toThrow();
  });

  it("leaves a switched-off warning out and still reports metrics", () => {
    const off = sense("check-warnings", false);

    expect(
      off.document.findings.filter((f) => f.severity === "warning"),
    ).toEqual([]);
    expect(off.metrics.length).toBeGreaterThan(0);
    expect(off.document.settings).toEqual({
      entry_points: [],
      entry_annotations: [],
      warnings: {
        cycle: false,
        orphan: false,
        unused_exports: false,
        private_imports: true,
        long_function: true,
      },
    });
  });
});

describe("structureSensor over the committed fixtures", () => {
  it("finds the five violations fixtures/check lists, by id", () => {
    const expected = fixture("check").expected("expected.json");
    const found = sense("check").document.findings.filter(
      (f) => f.severity === "violation",
    );

    expect(found.map((f) => f.id)).toEqual(
      expected.violations.map(violationId),
    );
    expect(found).toHaveLength(4);
  });

  it("finds the violation and cycle fixtures/check-warnings lists, by id", () => {
    const found = sense("check-warnings").document.findings.map((f) => f.id);

    const expected = fixture("check-warnings").expected("expected-policy.json");

    expect(found).toContain(violationId(expected.violations[0]));
    expect(found).toContain("cycle:app/domain/money.py,app/domain/order.py");
    expect(found.filter((id) => id.startsWith("rule-violation:"))).toHaveLength(
      1,
    );
  });
});

describe("grouped violation records", () => {
  it("writes one record per module and rule with an edge per import", () => {
    const edges = [
      { from: "d/a.py", to: "x/m1.py", kind: "depends", line: 3 },
      { from: "d/a.py", to: "x/m2.py", kind: "depends", line: 7 },
    ];
    const scan = repositoryFrom({
      schema_version: 7,
      scanner: { name: "t", version: "0" },
      commit: null,
      modified: false,
      files: [],
      selection: {
        extensions: [],
        skip_directory_names: [],
        skip_directory_prefixes: [],
        skip_directory_suffixes: [],
        skip_directories_containing: [],
        skip_file_globs: [],
      },
      modules: [],
      edges,
      foreign: [],
    });
    const policy = parsePolicy("forbid:\n  - d/** -> x/**\n");
    const document = structureSensor(
      scan,
      policy,
      DEFAULT_STRUCTURE_SETTINGS,
      CONTEXT,
    ).document;
    const found = document.findings.filter((f) => f.kind === "rule-violation");
    const rule = { type: "forbid", pattern: "d/** -> x/**" };

    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe("rule-violation:forbid d/** -> x/**:d/a.py");
    expect(found[0]?.evidence.modules).toEqual(["d/a.py"]);
    expect(found[0]?.evidence.edges).toEqual([
      {
        from: "d/a.py",
        to: "x/m1.py",
        kind: "depends",
        lines: [3],
        rules: [rule],
      },
      {
        from: "d/a.py",
        to: "x/m2.py",
        kind: "depends",
        lines: [7],
        rules: [rule],
      },
    ]);
    expect(found[0]?.summary).toBe(
      "depends on x/m1.py at line 3; depends on x/m2.py at line 7",
    );
  });
});

describe("the principle each finding cites", () => {
  const cited = (name: string, kind: string) =>
    sense(name).document.findings.filter((f) => f.kind === kind);

  it("cites levelization on a cycle", () => {
    const [cycle] = cited("check-warnings", "cycle");

    expect(cycle).toMatchObject(principleOf("levelization"));
  });

  it("cites the repository policy on a violation of the migrated check-warnings policy", () => {
    const found = cited("check-warnings", "rule-violation");

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject(principleOf("repository-policy"));
  });

  it("cites the repository policy, with no citation key, on forbid violations", () => {
    const found = cited("check", "rule-violation").filter((finding) =>
      finding.evidence.edges?.[0]?.rules?.every(
        (rule) => rule.type === "forbid",
      ),
    );

    expect(found.length).toBeGreaterThan(0);

    for (const finding of found) {
      expect(finding.principle).toBe("repository-policy");
      expect("citation" in finding).toBe(false);
    }
  });

  it("cites by the rules on each edge in the check fixture", () => {
    for (const finding of cited("check", "rule-violation")) {
      const level = finding.evidence.edges?.[0]?.rules?.some(
        (rule) => rule.type === "level",
      );

      expect(finding.principle).toBe(
        level ? "dependency-inversion-principle" : "repository-policy",
      );
      expect("citation" in finding).toBe(level);
    }
  });
});

describe("baseline compatibility", () => {
  it("reads the committed fixtures/check baseline against the new ids", () => {
    const { baselineText, scan, policy } = fixture("check");
    const baseline = parseBaseline(baselineText);
    const ranked = rankAgainstBaseline(
      collectViolations(scan, policy).violations,
      baseline,
    );

    expect(baseline).toHaveLength(2);
    expect(ranked.violations).toHaveLength(4);
    expect(ranked.new).toHaveLength(4);
    expect(ranked.fixed).toEqual([
      {
        from: "shop/application/place.py",
        to: "shop/adapters/sql_store.py",
        kind: "depends",
      },
    ]);
  });

  it("reads the committed fixtures/check-warnings baseline against the new ids", () => {
    const { baselineText, scan, policy } = fixture("check-warnings");
    const baseline = parseBaseline(baselineText);
    const ranked = rankAgainstBaseline(
      collectViolations(scan, policy).violations,
      baseline,
    );

    expect(baseline).toHaveLength(1);
    expect(ranked.violations).toHaveLength(1);
    expect(ranked.new).toEqual([]);
    expect(ranked.fixed).toEqual([]);
  });

  it.each(["check", "check-warnings"])(
    "serialises the %s baseline byte for byte",
    (name) => {
      const { baselineText } = fixture(name);

      expect(serialiseBaseline(parseBaseline(baselineText))).toBe(baselineText);
    },
  );
});

describe("measuredModules", () => {
  it("lists the modules the sensor measures, leaving out an ignored one", () => {
    const { scan, policy } = fixture("check");
    const withPolicy = measuredModules(scan, policy);
    const without = measuredModules(scan, null);

    expect(withPolicy.has("shop/main.py")).toBe(true);
    expect(withPolicy.has("tests/test_order.py")).toBe(false);
    expect(without.has("tests/test_order.py")).toBe(true);
  });

  it("equals the ids of the metrics the sensor reports", () => {
    const { scan, policy } = fixture("check");
    const { metrics } = structureSensor(
      scan,
      policy,
      DEFAULT_STRUCTURE_SETTINGS,
      CONTEXT,
    );

    expect([...measuredModules(scan, policy)].sort()).toEqual(
      metrics.map((metric) => metric.id).sort(),
    );
  });
});

describe("structure sensor inputs", () => {
  const scanWith = (files: { path: string; hash: string }[]) =>
    repositoryFrom({
      modules: [{ id: "a.py" }, { id: "b.py" }, { id: "c.py" }],
      files,
    });

  it("maps each hashed module to the scan's hash and omits one with no files entry", () => {
    const inputs = measuredInputs(
      scanWith([
        { path: "b.py", hash: "b".repeat(64) },
        { path: "a.py", hash: "a".repeat(64) },
      ]),
    );

    expect(inputs).toEqual({
      "a.py": "a".repeat(64),
      "b.py": "b".repeat(64),
    });
    expect(Object.keys(inputs)).toEqual(["a.py", "b.py"]);
  });

  it("writes findings version 2 with the inputs and no tests", () => {
    const result = sense("check-warnings");

    expect(result.document.findings_version).toBe(2);
    expect(result.document.inputs).toBeDefined();
    expect(result.document.tests).toBeUndefined();
  });
});
