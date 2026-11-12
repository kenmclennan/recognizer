import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { validateFindings } from "../src/findings-document.js";
import { REPO } from "./helpers.js";
import {
  type FakeOptions,
  fakeIo,
  hashedScan,
  inputsOf,
  mountedModules,
  POLICY_PROBLEM,
  PYTHON,
  ROOT,
  TYPESCRIPT,
} from "./scan-helpers.js";

const COMMIT = "abc123";
const read = (path: string) => readFileSync(join(REPO, path), "utf8");
const checkScan = JSON.parse(read("fixtures/check/scan.json"));
const expected = JSON.parse(read("fixtures/check/expected.json"));
const policyFiles = {
  [`${ROOT}/.recognizer/policy.yaml`]: read(
    "fixtures/check/.recognizer/policy.yaml",
  ),
  [`${ROOT}/.recognizer/baselines/violations.json`]: read(
    "fixtures/check/.recognizer/baselines/violations.json",
  ),
};

function cached(scan: Record<string, unknown>, commit = COMMIT) {
  return JSON.stringify(hashedScan(scan, commit));
}

function setup(files: Record<string, string> = {}, options: FakeOptions = {}) {
  return fakeIo({
    commit: COMMIT,
    files: {
      [`${ROOT}/shop/a.py`]: "",
      ...mountedModules(checkScan),
      [`${ROOT}/.recognizer/cache/scan.python.json`]: cached(checkScan),
      ...policyFiles,
      ...files,
    },
    ...options,
  });
}

function check(argv: string[], fake = setup()) {
  const code = run(["check", ...argv, "--repository", ROOT], fake.io);

  return { code, out: fake.out(), err: fake.err(), fake };
}

describe("check in repository mode", () => {
  it("equals expected.json for the same scan", () => {
    const { code, out, err } = check(["--json"]);
    const report = JSON.parse(out);

    delete report.baseline.path;

    expect(code).toBe(1);
    expect(report.sensors).toEqual([
      {
        name: "structure",
        status: "ran",
        settings: {
          entry_points: [],
          warnings: {
            cycle: true,
            orphan: true,
            unused_exports: false,
            private_imports: true,
            long_function: true,
          },
        },
      },
    ]);

    delete report.sensors;

    expect(report).toEqual(expected);
    expect(err).toBe(POLICY_PROBLEM);
  });

  it("prints the summary and the warnings as text on stdout only", () => {
    const { code, out, err } = check([]);

    expect(code).toBe(1);
    expect(out).toContain("violations: 5, new: 4, fixed: 1, unranked: 1");
    expect(out).toContain("warnings: ");
    expect(err).toBe(POLICY_PROBLEM);
  });

  it("reports metrics and warnings only when there is no policy", () => {
    const fake = fakeIo({
      commit: COMMIT,
      files: {
        [`${ROOT}/shop/a.py`]: "",
        ...mountedModules(checkScan),
        [`${ROOT}/.recognizer/cache/scan.python.json`]: cached(checkScan),
      },
    });
    const { code, out } = check(["--json"], fake);

    expect(code).toBe(0);
    expect(Object.keys(JSON.parse(out)).sort()).toEqual([
      "folder_metrics",
      "metrics",
      "sensors",
      "warnings",
    ]);
  });

  it("refreshes a stale cache first and writes only cache files", () => {
    const stale = setup(
      {
        [`${ROOT}/.recognizer/cache/scan.python.json`]: cached(
          checkScan,
          "old",
        ),
      },
      {
        scanners: {
          [PYTHON]: {
            output: JSON.stringify(hashedScan(checkScan, COMMIT)),
          },
        },
      },
    );
    const { code, out, err } = check(["--json"], stale);

    expect(code).toBe(1);
    expect(JSON.parse(out).new).toHaveLength(4);
    expect(err).toContain("python:");
    expect(stale.calls.some((call) => call.command === PYTHON)).toBe(true);
    expect(
      stale.writes.every((path) => path.includes("/.recognizer/cache/")),
    ).toBe(true);
  });

  it("does not report a baseline entry as fixed because another scan lacks it", () => {
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
    const fake = setup({
      [`${ROOT}/web/index.ts`]: "",
      [`${ROOT}/.recognizer/cache/scan.typescript.json`]: cached(other),
    });
    const { out } = check(["--json"], fake);

    expect(JSON.parse(out).fixed).toEqual(expected.fixed);
    expect(TYPESCRIPT).toBeDefined();
  });

  it("narrows violations, warnings and metrics to the named modules", () => {
    const named = "shop/adapters/sql_store.py";
    const { out } = check([named, "--json"]);
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

  it("follows the narrowed set for the exit code", () => {
    const clean = check(["shop/main.py"]);

    expect(clean.code).toBe(0);
    expect(check(["shop/adapters/sql_store.py"]).code).toBe(1);
  });

  it("exits 2 for an unknown module", () => {
    expect(check(["no/such.py"]).code).toBe(2);
  });

  it("exits 2 for a baseline flag with a module", () => {
    const result = check(["shop/main.py", "--update-baseline"]);

    expect(result.code).toBe(2);
    expect(result.fake.writes).toEqual([]);
  });

  it("exits 2 for a baseline flag without a policy", () => {
    const fake = fakeIo({
      commit: COMMIT,
      files: {
        [`${ROOT}/shop/a.py`]: "",
        [`${ROOT}/.recognizer/cache/scan.python.json`]: cached(checkScan),
      },
    });

    expect(check(["--init-baseline"], fake).code).toBe(2);
  });
});

describe("check with --scan", () => {
  it.each([
    [["--scan", "x.json", "--json"]],
    [["--scan", "x.json", "shop/main.py"]],
    [["--scan", "x.json", "--repository", ROOT]],
  ])("exits 2 for %j", (argv) => {
    const fake = fakeIo({ files: { "x.json": "{}" } });

    expect(run(["check", ...argv], fake.io)).toBe(2);
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
    principle: "Do not repeat yourself",
    fix_pattern: "extract-shared-function",
    summary: `summary ${id}`,
    evidence: {
      modules: ["shop/domain/order.py"],
      members: sizes.map((size, index) => member(`m${index}`, size)),
    },
  });
  const duplication = JSON.stringify({
    findings_version: 1,
    sensor: { name: "duplication", version: "1" },
    commit: COMMIT,
    modified: false,
    settings: {},
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

  it("lists the warning lines largest first, ties by id, in text and in json", () => {
    const fake = setup({
      [`${ROOT}/.recognizer/cache/findings/duplication.json`]: duplication,
    });
    const text = check([], fake).out.split("\n");
    const at = order.map((summary) =>
      text.findIndex((line) => line.includes(summary)),
    );

    expect(at.every((index) => index >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));

    const json = JSON.parse(
      check(
        ["--json"],
        setup({
          [`${ROOT}/.recognizer/cache/findings/duplication.json`]: duplication,
        }),
      ).out,
    );
    const ids = json.warnings
      .filter((warning: { summary: string }) =>
        warning.summary.startsWith("summary duplication:"),
      )
      .map((warning: { summary: string }) => warning.summary);

    expect(ids).toEqual(order);
  });
});

describe("a structure file from before the folder cycle was removed", () => {
  const STORED = `${ROOT}/.recognizer/cache/findings/structure.json`;

  function oldFile() {
    return JSON.stringify({
      findings_version: 2,
      sensor: { name: "structure", version: "16" },
      commit: COMMIT,
      modified: false,
      settings: {
        entry_points: [],
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
          principle: "no-cycles",
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

  it("is recomputed, so no folder cycle is reported and the file is rewritten", () => {
    const fake = setup({ [STORED]: oldFile() });

    expect(fake.files.get(STORED)).toContain("folder_cycle");

    const { out } = check(["--json"], fake);
    const ids = JSON.parse(out).warnings.map((one: { id: string }) => one.id);
    const rewritten = JSON.parse(fake.files.get(STORED) as string);

    expect(ids).not.toContain("folder_cycle");
    expect(rewritten.settings.warnings).not.toHaveProperty("folder_cycle");
    expect(
      rewritten.findings.map((one: { kind: string }) => one.kind),
    ).not.toContain("folder_cycle");
  });
});

describe("a structure file from before policy drift became a policy problem", () => {
  const STORED = `${ROOT}/.recognizer/cache/findings/structure.json`;

  function oldFile() {
    return JSON.stringify({
      findings_version: 2,
      sensor: { name: "structure", version: "16" },
      commit: COMMIT,
      modified: false,
      settings: {
        entry_points: [],
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
          summary: "folder a holds 1 scanned modules that no component covers",
          fix_pattern: "old-fix-pattern",
          evidence: { modules: ["a/x.py"] },
        },
      ],
    });
  }

  it("is recomputed, so no policy drift is reported and the file is rewritten", () => {
    const fake = setup({ [STORED]: oldFile() });

    expect(fake.files.get(STORED)).toContain("policy_drift");

    const { out } = check(["--json"], fake);
    const ids = JSON.parse(out).warnings.map((one: { id: string }) => one.id);
    const rewritten = JSON.parse(fake.files.get(STORED) as string);

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
  const STORED = `${ROOT}/.recognizer/cache/findings/structure.json`;

  function oldFile() {
    return JSON.stringify({
      findings_version: 2,
      sensor: { name: "structure", version: "16" },
      commit: COMMIT,
      modified: false,
      settings: {
        instability_gap: 0.2,
        composition_roots: [],
        entry_points: [],
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

  it("is recomputed, so no stable dependencies finding is reported and the file is rewritten", () => {
    const fake = setup({ [STORED]: oldFile() });

    expect(fake.files.get(STORED)).toContain("stable_dependencies");
    expect(() =>
      validateFindings(JSON.parse(oldFile()), {
        name: "structure",
        commit: COMMIT,
      }),
    ).not.toThrow();

    const { out } = check(["--json"], fake);
    const ids = JSON.parse(out).warnings.map((one: { id: string }) => one.id);
    const rewritten = JSON.parse(fake.files.get(STORED) as string);

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

  function runOn(scan: Record<string, unknown>, ...flags: string[]) {
    const fake = fakeIo({
      commit: COMMIT,
      files: {
        ...mountedModules(scan),
        [`${ROOT}/.recognizer/cache/scan.python.json`]: cached(scan),
      },
    });

    run(["check", ...flags, "--repository", ROOT], fake.io);

    return fake.out();
  }

  function lonely(out: string) {
    return JSON.parse(out).warnings.find(
      (one: { id: string; evidence: { modules: string[] } }) =>
        one.id === "orphan" && one.evidence.modules[0] === "a/lonely.py",
    );
  }

  it("prints at most 10 test files with their names and counts the rest", () => {
    const lines = runOn(orphanScan(12)).split("\n");
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

  it("prints several names and names unknown", () => {
    const out = runOn(orphanScan(2, 2));

    expect(out).toContain("\n  tests/t01.py: Small\n");
    expect(out).toContain("\n  tests/t02.py: (names unknown)\n");
    expect(out).not.toContain("more test files");
    expect(runOn(orphanScan(10))).toContain("  tests/t10.py: Big, Small");
  });

  it("carries every test importer in --json", () => {
    const warning = lonely(runOn(orphanScan(12), "--json"));

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

  it("prints no test file lines for an orphan nothing imports", () => {
    const out = runOn({ ...orphanScan(0), test_imports: [] });

    expect(out).toContain("a/lonely.py is imported by no module");
    expect(out).not.toContain("test file");
  });
});
