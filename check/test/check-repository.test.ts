import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { REPO } from "./helpers.js";
import {
  type FakeOptions,
  fakeIo,
  hashedScan,
  inputsOf,
  mountedModules,
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
          hub_threshold: 10,
          instability_gap: 0.2,
          composition_roots: [],
          entry_points: [],
          warnings: {
            cycle: true,
            hub: true,
            folder_cycle: true,
            orphan: true,
            policy_drift: true,
            stable_dependencies: true,
            unused_exports: false,
          },
        },
      },
    ]);

    delete report.sensors;

    expect(report).toEqual(expected);
    expect(err).toBe("");
  });

  it("prints the summary and the warnings as text on stdout only", () => {
    const { code, out, err } = check([]);

    expect(code).toBe(1);
    expect(out).toContain("violations: 5, new: 4, fixed: 1, unranked: 1");
    expect(out).toContain("warnings: ");
    expect(err).toBe("");
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
      "thresholds",
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
