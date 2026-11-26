import { STRUCTURE_SENSOR_VERSION } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { validateFindings } from "../src/findings-document.js";
import { FIXTURE_LANGUAGES } from "./language-behaviour-fixture.js";
import {
  CHECK_BASELINE,
  checkBaselineText,
  checkPolicyText,
  checkScan,
  checkScenario,
  checkExpected as expected,
  inputsOf,
} from "./support/check-scenario.js";
import { type CliScenario, cliScenario } from "./support/cli-scenario.js";

const NOT_MEASURED =
  "duplication not measured since the last scan: run recognizer scan\n" +
  "complexity not measured since the last scan: run recognizer scan\n";
const ALL = FIXTURE_LANGUAGES.map((one) => one.name);
interface Rewritten {
  settings: Record<string, unknown> & { warnings: Record<string, unknown> };
  findings: { kind: string }[];
}

const STRUCTURE_FINDINGS = ".recognizer/cache/findings/structure.json";

function untouched(scenario: Pick<CliScenario, "root" | "repository">) {
  return scenario.root.io.run("git", [
    "-C",
    scenario.repository,
    "status",
    "--porcelain",
  ]).stdout;
}

describe("check in repository mode", () => {
  it("equals expected.json for the same scan", async () => {
    const { exit, out, err } = await checkScenario().check(["--json"]);
    const report = JSON.parse(out);

    delete report.baseline.path;

    expect(exit).toBe(1);
    expect(report.sensors).toEqual([
      {
        name: "structure",
        status: "partial",
        not_measured: ["duplication", "complexity"],
        settings: {
          duplication: {
            threshold: 0.82,
            min_lines: 4,
            pair_min_lines: 6,
            min_nodes: 20,
          },
          entry_points: [],
          entry_annotations: [],
          warnings: {
            cycle: true,
            orphan: true,
            unused_exports: false,
            private_imports: true,
            long_function: true,
            complexity: true,
          },
          long_function_limit: 20,
          complexity_limit: 10,
        },
      },
    ]);

    delete report.sensors;

    expect(report).toEqual(expected);
    expect(err).toBe(NOT_MEASURED);
  });

  it("prints the summary and the warnings as text on stdout only", async () => {
    const { exit, out, err } = await checkScenario().check([]);

    expect(exit).toBe(1);
    expect(out).toContain("violations: 4, new: 4, fixed: 1");
    expect(out).toContain("warnings: ");
    expect(err).toBe(NOT_MEASURED);
  });

  it("reports metrics and warnings only when there is no policy", async () => {
    const scenario = checkScenario({ policy: false, baseline: false });
    const { exit, out } = await scenario.check(["--json"]);

    expect(exit).toBe(0);
    expect(Object.keys(JSON.parse(out)).sort()).toEqual([
      "folder_metrics",
      "metrics",
      "sensors",
      "warnings",
    ]);
  });

  it("refreshes a stale cache first and writes only cache files", async () => {
    const stale = checkScenario({ cache: { commit: "old" } });
    const { exit, out, err } = await stale.check(["--json"]);

    expect(exit).toBe(1);
    expect(JSON.parse(out).new).toHaveLength(4);
    expect(err).toContain("python:");
    expect(stale.scanCalls("python")).toBeGreaterThan(0);
    expect(untouched(stale)).toBe("");
  });

  it("does not report a baseline entry as fixed because another scan lacks it", async () => {
    const other = {
      ...checkScan,
      modules: [
        {
          id: "web/index.ts",
          language: "typescript",
          kind: "module",
          members: [],
        },
      ],
      edges: [],
      foreign: [],
    };
    const scenario = checkScenario({
      files: { "web/index.ts": "" },
      caches: { typescript: other },
    });
    const { out } = await scenario.check(["--json"]);

    expect(JSON.parse(out).fixed).toEqual(expected.fixed);
  });

  it("narrows violations, warnings and metrics to the named files", async () => {
    const named = "shop/adapters/sql_store.py";
    const { out } = await checkScenario().check([named, "--json"]);
    const report = JSON.parse(out);

    expect(report.violations.length).toBeGreaterThan(0);
    expect(
      report.violations.every(
        (v: { from: string; to: string }) => v.from === named || v.to === named,
      ),
    ).toBe(true);
    expect(report.metrics.map((m: { id: string }) => m.id)).toEqual([named]);
    expect(report.folder_metrics.map((m: { id: string }) => m.id)).toEqual([
      "shop/adapters",
    ]);
  });

  it("follows the narrowed set for the exit code", async () => {
    const scenario = checkScenario();
    const clean = await scenario.check(["shop/main.py"]);

    expect(clean.exit).toBe(0);
    expect((await scenario.check(["shop/adapters/sql_store.py"])).exit).toBe(1);
  });

  it("exits 2 for an unknown file", async () => {
    expect((await checkScenario().check(["no/such.py"])).exit).toBe(2);
  });

  it("exits 2 for a baseline flag with a file", async () => {
    const scenario = checkScenario();
    const result = await scenario.check(["shop/main.py", "--update-baseline"]);

    expect(result.exit).toBe(2);
    expect(scenario.read(CHECK_BASELINE)).toBe(checkBaselineText);
    expect(untouched(scenario)).toBe("");
  });

  it("exits 2 for a baseline flag without a policy", async () => {
    const scenario = checkScenario({ policy: false, baseline: false });

    expect((await scenario.check(["--init-baseline"])).exit).toBe(2);
  });
});

const CURRENT_IMPORTS = [
  { from: "shop/adapters/sql_store.py", to: "foreign:requests" },
  { from: "shop/adapters/sql_store.py", to: "shop/adapters/memory_store.py" },
  { from: "shop/domain/money.py", to: "shop/ports/store.py" },
  { from: "shop/domain/order.py", to: "shop/adapters/memory_store.py" },
  { from: "shop/domain/order.py", to: "shop/application/place.py" },
];

describe("check writes the baseline per import", () => {
  it("init-baseline writes one entry per import and one for an edge under two rules", async () => {
    const policy = checkPolicyText.replace(
      "ignore:",
      "  - shop/domain/* -> shop/adapters/*\nignore:",
    );
    const scenario = checkScenario({ policy, baseline: false });
    const result = await scenario.check(["--init-baseline", "--json"]);
    const written = scenario.readJson<{ violations: { to?: string }[] }>(
      CHECK_BASELINE,
    ).violations;

    expect(result.exit).toBe(0);
    expect(written).toHaveLength(5);
    expect(written.map((entry) => entry.to ?? "").sort()).toEqual(
      CURRENT_IMPORTS.map((one) => one.to).sort(),
    );
    expect(JSON.parse(result.out).violations).toHaveLength(5);
  });

  it("update-baseline shrinks by an import of a surviving finding", async () => {
    const kept = CURRENT_IMPORTS.map((one) => ({ ...one, kind: "depends" }));
    const stale = {
      from: "shop/domain/order.py",
      to: "shop/application/gone.py",
      kind: "depends",
    };
    const entries = kept.map((one) =>
      one.to === "shop/ports/store.py" ? { ...one, kind: "implements" } : one,
    );
    const scenario = checkScenario({
      baseline: `${JSON.stringify(
        {
          schema_version: 1,
          violations: [...entries.slice(0, 4), stale, entries[4]],
        },
        null,
        2,
      )}\n`,
    });
    const result = await scenario.check(["--update-baseline"]);
    const written = scenario.readJson<{ violations: unknown[] }>(
      CHECK_BASELINE,
    ).violations;

    expect(result.exit).toBe(0);
    expect(written).toHaveLength(5);
    expect(written).not.toContainEqual(stale);
  });
});

describe("check with --scan", () => {
  it.each([
    [["--scan", "x.json", "--json"]],
    [["--scan", "x.json", "shop/main.py"]],
    [["--scan", "x.json", "--repository", "/repo"]],
  ])("exits 2 for %j", async (argv) => {
    const scenario = cliScenario({ files: { "x.json": "{}" } });

    expect((await scenario.run(["check", ...argv])).exit).toBe(2);
  });
});

describe("check --scan with files no installed scanner publishes", () => {
  const replay = async (languages?: string[]) => {
    const scenario = checkScenario({
      files: { "x.json": checkScan },
      cache: false,
      ...(languages === undefined ? { languages: ALL } : { languages }),
    });
    const result = await scenario.run([
      "check",
      "--scan",
      `${scenario.repository}/x.json`,
    ]);

    return {
      code: result.exit,
      out: JSON.parse(result.out),
      err: result.err,
    };
  };

  it("prints an unknown line and unknown_files for an unpublished language", async () => {
    const { out, err } = await replay(["typescript"]);
    const pythonFiles = checkScan.modules.filter(
      (one: { language: string }) => one.language === "python",
    );

    expect(pythonFiles.length).toBeGreaterThan(0);
    expect(out.unknown_files.languages).toEqual(["python"]);
    expect(out.unknown_files.files).toHaveLength(pythonFiles.length);
    expect(err).toContain(`unknown: ${pythonFiles.length} files in python:`);
    expect(err).toContain("unknown, not clean");
  });

  it("prints neither for published languages", async () => {
    const { out, err } = await replay();

    expect(out).not.toHaveProperty("unknown_files");
    expect(err).not.toContain("unknown:");
  });

  it("exits the same whether or not the language is published", async () => {
    expect((await replay(["typescript"])).code).toBe((await replay()).code);
  });
});

describe("check --scan over committed content with the shipped manifests", () => {
  const replayWith = async (names: string[]) => {
    const scenario = checkScenario({
      files: { "x.json": checkScan },
      cache: false,
      languages: names,
    });
    const result = await scenario.run([
      "check",
      "--scan",
      `${scenario.repository}/x.json`,
    ]);

    return JSON.parse(result.out);
  };

  it("expects no unknown_files with every manifest published", async () => {
    expect(await replayWith(ALL)).not.toHaveProperty("unknown_files");
  });

  it("names the python files when the python entry is removed", async () => {
    const python = checkScan.modules.filter(
      (one: { language: string }) => one.language === "python",
    );
    const report = await replayWith(ALL.filter((name) => name !== "python"));

    expect(python.length).toBeGreaterThan(0);
    expect(report.unknown_files?.languages).toEqual(["python"]);
    expect(report.unknown_files?.files).toHaveLength(python.length);
  });
});

describe("check ranks duplication warnings by lines duplicated", () => {
  const member = (name: string, size: number) => ({
    module: "shop/domain/order.py",
    name,
    file: "shop/domain/order.py",
    lines: [1, size] as [number, number],
  });
  const finding = (id: string, sizes: number[]) => ({
    id,
    kind: "duplication",
    severity: "warning",
    principle: "dont-repeat-yourself",
    fix_pattern: "extract-shared-function",
    summary: `summary ${id}`,
    evidence: {
      modules: ["shop/domain/order.py"],
      members: sizes.map((size, index) => member(`m${index}`, size)),
    },
  });
  const duplication = (commit: string) =>
    JSON.stringify({
      findings_version: 2,
      sensor: { name: "structure", version: STRUCTURE_SENSOR_VERSION },
      commit,
      modified: false,
      settings: {
        duplication: {
          threshold: 0.82,
          min_lines: 4,
          pair_min_lines: 6,
          min_nodes: 20,
        },
      },
      inputs: inputsOf(checkScan),
      findings: [
        finding("duplication:a", [6, 6]),
        finding("duplication:b", [5, 5, 5, 5]),
        finding("duplication:c", [7, 7]),
        finding("duplication:d", [10, 10]),
      ],
    });

  const order = [
    "summary duplication:b",
    "summary duplication:d",
    "summary duplication:c",
    "summary duplication:a",
  ];

  it("lists the warning lines largest first, ties by id, in text and in json", async () => {
    const scenario = checkScenario();

    scenario.cache(STRUCTURE_FINDINGS, duplication(scenario.commit));

    const text = (await scenario.check([])).out.split("\n");
    const at = order.map((summary) =>
      text.findIndex((line) => line.includes(summary)),
    );

    expect(at.every((index) => index >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));

    const json = JSON.parse((await scenario.check(["--json"])).out);
    const ids = json.warnings
      .filter((warning: { summary: string }) =>
        warning.summary.startsWith("summary duplication:"),
      )
      .map((warning: { summary: string }) => warning.summary);

    expect(ids).toEqual(order);
  });
});

describe("a structure file from before the folder cycle was removed", () => {
  function oldFile(commit: string) {
    return JSON.stringify({
      findings_version: 2,
      sensor: { name: "structure", version: "16" },
      commit,
      modified: false,
      settings: {
        entry_points: [],
        entry_annotations: [],
        warnings: {
          cycle: true,
          folder_cycle: true,
          orphan: true,
          unused_exports: false,
          private_imports: true,
          long_function: true,
        },
      },
      findings: [
        {
          id: "folder_cycle:a,b",
          kind: "folder_cycle",
          severity: "warning",
          principle: "levelization",
          summary: "folders a and b import each other",
          fix_pattern: "break-folder-cycle",
          evidence: {
            modules: ["a/x.py", "b/y.py"],
            cuts: [{ from: "a/x.py", to: "b/y.py" }],
          },
        },
      ],
    });
  }

  it("is recomputed, so no folder cycle is reported and the file is rewritten", async () => {
    const scenario = checkScenario();

    scenario.cache(STRUCTURE_FINDINGS, oldFile(scenario.commit));

    expect(scenario.read(STRUCTURE_FINDINGS)).toContain("folder_cycle");

    const { out } = await scenario.check(["--json"]);
    const ids = JSON.parse(out).warnings.map((one: { id: string }) => one.id);
    const rewritten = scenario.readJson<Rewritten>(STRUCTURE_FINDINGS);

    expect(ids).not.toContain("folder_cycle");
    expect(rewritten.settings.warnings).not.toHaveProperty("folder_cycle");
    expect(
      rewritten.findings.map((one: { kind: string }) => one.kind),
    ).not.toContain("folder_cycle");
  });
});

describe("a structure file from before policy drift became a policy problem", () => {
  function oldFile(commit: string) {
    return JSON.stringify({
      findings_version: 2,
      sensor: { name: "structure", version: "16" },
      commit,
      modified: false,
      settings: {
        entry_points: [],
        entry_annotations: [],
        warnings: {
          cycle: true,
          orphan: true,
          policy_drift: true,
          unused_exports: false,
          private_imports: true,
          long_function: true,
        },
      },
      findings: [
        {
          id: "policy_drift:folder:a",
          kind: "policy_drift",
          severity: "warning",
          principle: "old-principle",
          summary: "folder a holds 1 scanned files that no component covers",
          fix_pattern: "old-fix-pattern",
          evidence: { modules: ["a/x.py"] },
        },
      ],
    });
  }

  it("is recomputed, so no policy drift is reported and the file is rewritten", async () => {
    const scenario = checkScenario();

    scenario.cache(STRUCTURE_FINDINGS, oldFile(scenario.commit));

    expect(scenario.read(STRUCTURE_FINDINGS)).toContain("policy_drift");

    const { out } = await scenario.check(["--json"]);
    const ids = JSON.parse(out).warnings.map((one: { id: string }) => one.id);
    const rewritten = scenario.readJson<Rewritten>(STRUCTURE_FINDINGS);

    expect(ids.filter((id: string) => id.startsWith("policy_drift"))).toEqual(
      [],
    );
    expect(rewritten.settings.warnings).not.toHaveProperty("policy_drift");
    expect(
      rewritten.findings.map((one: { kind: string }) => one.kind),
    ).not.toContain("policy_drift");
  });
});

describe("a structure file from before the stable dependencies warning was removed", () => {
  function oldFile(commit: string) {
    return JSON.stringify({
      findings_version: 2,
      sensor: { name: "structure", version: "16" },
      commit,
      modified: false,
      settings: {
        instability_gap: 0.2,
        composition_roots: [],
        entry_points: [],
        entry_annotations: [],
        warnings: {
          cycle: true,
          orphan: true,
          stable_dependencies: true,
          unused_exports: false,
          private_imports: true,
          long_function: true,
        },
      },
      inputs: {},
      findings: [
        {
          id: "stable_dependencies:a->b",
          kind: "stable_dependencies",
          severity: "warning",
          principle: "dependencies-point-toward-stability",
          summary: "folder a depends on folder b, which is less stable",
          fix_pattern: "depend-on-stabler-folder",
          evidence: { modules: ["a/x.py", "b/y.py"] },
        },
      ],
    });
  }

  it("is recomputed, so no stable dependencies finding is reported and the file is rewritten", async () => {
    const scenario = checkScenario();

    scenario.cache(STRUCTURE_FINDINGS, oldFile(scenario.commit));

    expect(scenario.read(STRUCTURE_FINDINGS)).toContain("stable_dependencies");
    expect(() =>
      validateFindings(JSON.parse(oldFile(scenario.commit)), {
        name: "structure",
        commit: scenario.commit,
      }),
    ).not.toThrow();

    const { out } = await scenario.check(["--json"]);
    const ids = JSON.parse(out).warnings.map((one: { id: string }) => one.id);
    const rewritten = scenario.readJson<Rewritten>(STRUCTURE_FINDINGS);

    expect(ids.some((id: string) => id.startsWith("stable_dependencies"))).toBe(
      false,
    );
    expect(Object.keys(rewritten.settings)[0]).toBe("entry_points");
    expect(rewritten.settings).not.toHaveProperty("instability_gap");
    expect(rewritten.settings).not.toHaveProperty("composition_roots");
    expect(rewritten.settings.warnings).not.toHaveProperty(
      "stable_dependencies",
    );
    expect(
      rewritten.findings.map((one: { kind: string }) => one.kind),
    ).not.toContain("stable_dependencies");
  });
});

describe("orphan test importers in the report", () => {
  function orphanScan(testFiles: number, unknownAt = 12) {
    const test_imports = [];

    for (let at = 1; at <= testFiles; at += 1) {
      test_imports.push({
        from: `tests/t${String(at).padStart(2, "0")}.py`,
        to: "a/lonely.py",
        ...(at === unknownAt
          ? {}
          : { names: at === 10 || at === 11 ? ["Big", "Small"] : ["Small"] }),
      });
    }

    return {
      ...checkScan,
      modules: [
        { id: "a/lonely.py", language: "python", kind: "module", members: [] },
        { id: "a/other.py", language: "python", kind: "module", members: [] },
      ],
      edges: [],
      foreign: [],
      test_imports,
    };
  }

  async function runOn(scan: Record<string, unknown>, ...flags: string[]) {
    const scenario = checkScenario({
      scan,
      policy: false,
      baseline: false,
      stub: false,
    });

    return (await scenario.check(flags)).out;
  }

  function lonely(out: string) {
    return JSON.parse(out).warnings.find(
      (one: { id: string; evidence: { modules: string[] } }) =>
        one.id === "orphan" && one.evidence.modules[0] === "a/lonely.py",
    );
  }

  it("prints at most 10 test files with their names and counts the rest", async () => {
    const lines = (await runOn(orphanScan(12))).split("\n");
    const at = lines.findIndex((line) =>
      line.startsWith("warning: a/lonely.py"),
    );

    expect(lines[at]).toContain(
      "a/lonely.py is imported only by 12 test files",
    );
    expect(lines[at]).toContain(
      "tests/t01.py, tests/t02.py, tests/t03.py and 9 more",
    );
    expect(lines[at + 1]).toBe("  tests/t01.py: Small");
    expect(lines[at + 10]).toBe("  tests/t10.py: Big, Small");
    expect(lines[at + 11]).toBe("  and 2 more test files");
  });

  it("prints several names and names unknown", async () => {
    const out = await runOn(orphanScan(2, 2));

    expect(out).toContain("\n  tests/t01.py: Small\n");
    expect(out).toContain("\n  tests/t02.py: (names unknown)\n");
    expect(out).not.toContain("more test files");
    expect(await runOn(orphanScan(10))).toContain("  tests/t10.py: Big, Small");
  });

  it("carries every test importer in --json", async () => {
    const warning = lonely(await runOn(orphanScan(12), "--json"));

    expect(warning.fix_pattern).toBe("move-orphan-to-tests");
    expect(warning.evidence.test_importers).toHaveLength(12);
    expect(warning.evidence.test_importers[10]).toEqual({
      file: "tests/t11.py",
      names: ["Big", "Small"],
    });
    expect(warning.evidence.test_importers[11]).toEqual({
      file: "tests/t12.py",
      names: [],
    });
  });

  it("prints no test file lines for an orphan nothing imports", async () => {
    const out = await runOn({ ...orphanScan(0), test_imports: [] });

    expect(out).toContain("a/lonely.py is imported by no file");
    expect(out).not.toContain("test file");
  });
});
