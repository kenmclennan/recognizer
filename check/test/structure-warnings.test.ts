import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config-parse.js";
import { InputError } from "../src/errors.js";
import { parsePolicy, validateScan } from "../src/index.js";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  describeSettings,
  resolveStructureSettings,
  type StructureSettings,
  structureSensor,
} from "../src/structure-sensor.js";
import {
  folderCycleFindings,
  orphanFindings,
  policyDriftFindings,
} from "../src/structure-warnings.js";
import { REPO } from "./helpers.js";

function scanOf(edges: [string, string][], modules: string[] = []) {
  const ids = new Set([...modules, ...edges.flat()]);

  return validateScan({
    schema_version: 5,
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
    modules: [...ids]
      .filter((id) => !id.startsWith("foreign:"))
      .map((id) => ({ id, language: "python", kind: "module", members: [] })),
    edges: edges.map(([from, to], index) => ({
      from,
      to,
      kind: "depends",
      line: index + 1,
    })),
    foreign: [],
  });
}

const CONTEXT = { commit: "abc", modified: false };

function ids(findings: { id: string }[]) {
  return findings.map((finding) => finding.id);
}

describe("folder_cycle", () => {
  it("names every crossing edge of a pair importing both ways", () => {
    const found = folderCycleFindings(
      scanOf([
        ["a/x.py", "b/y.py"],
        ["a/x2.py", "b/y.py"],
        ["b/y.py", "a/x.py"],
      ]),
      null,
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: "folder_cycle:a,b",
      kind: "folder_cycle",
      severity: "warning",
      principle: "no-cycles",
      fix_pattern: "break-folder-cycle",
      summary: "folders a and b import each other (3 edges)",
    });
    expect(found[0]?.evidence.edges).toEqual([
      { from: "a/x.py", to: "b/y.py" },
      { from: "a/x2.py", to: "b/y.py" },
      { from: "b/y.py", to: "a/x.py" },
    ]);
    expect(found[0]?.evidence.modules).toEqual(["a/x.py", "a/x2.py", "b/y.py"]);
  });

  it("reports nothing for edges in one direction", () => {
    expect(folderCycleFindings(scanOf([["a/x.py", "b/y.py"]]), null)).toEqual(
      [],
    );
  });

  it("reports nothing for a ring of three folders", () => {
    const ring = scanOf([
      ["a/x.py", "b/y.py"],
      ["b/y.py", "c/z.py"],
      ["c/z.py", "a/x.py"],
    ]);

    expect(folderCycleFindings(ring, null)).toEqual([]);
  });

  it("pairs an ancestor and a descendant folder", () => {
    const found = folderCycleFindings(
      scanOf([
        ["a/x.py", "a/b/y.py"],
        ["a/b/y.py", "a/x.py"],
      ]),
      null,
    );

    expect(ids(found)).toEqual(["folder_cycle:a,a/b"]);
  });

  it("leaves two modules of one folder to the module cycle", () => {
    const same = scanOf([
      ["a/x.py", "a/y.py"],
      ["a/y.py", "a/x.py"],
    ]);

    expect(folderCycleFindings(same, null)).toEqual([]);
  });
});

describe("orphan", () => {
  const orphans = (
    modules: string[],
    entryPoints: string[] = [],
    policy: string | null = null,
    edges: [string, string][] = [],
  ) =>
    ids(
      orphanFindings(
        scanOf(edges, modules),
        policy === null ? null : parsePolicy(policy),
        entryPoints,
      ),
    );

  it("reports a plain module nothing imports", () => {
    expect(orphans(["app/plain.py"])).toEqual(["orphan:app/plain.py"]);
  });

  it("describes the finding", () => {
    const [finding] = orphanFindings(scanOf([], ["app/plain.py"]), null, []);

    expect(finding).toMatchObject({
      kind: "orphan",
      severity: "warning",
      principle: "every-module-is-reachable",
      fix_pattern: "remove-or-wire-orphan",
      summary:
        "app/plain.py is imported by no module and is not an entry point",
      evidence: { modules: ["app/plain.py"] },
    });
  });

  it("exempts a module a policy entry names literally", () => {
    expect(
      orphans(["app/cli.py"], [], "components:\n  entry: [app/cli.py]\n"),
    ).toEqual([]);
  });

  it("does not exempt on a wildcard policy glob", () => {
    expect(
      orphans(["app/cli.py"], [], "components:\n  all: [app/**]\n"),
    ).toEqual(["orphan:app/cli.py"]);
  });

  it.each([
    "app/test_x.py",
    "app/x_test.py",
    "app/conftest.py",
    "app/x.test.ts",
    "app/x.spec.tsx",
    "tests/helper.py",
    "app/__tests__/helper.ts",
    "app/FooTest.kt",
    "app/FooTests.kt",
  ])("exempts the test file %s", (id) => {
    expect(orphans([id])).toEqual([]);
  });

  it.each([
    "app/index.ts",
    "app/__init__.py",
    "app/main.py",
    "app/mod.rs",
    "app/lib.rs",
    "app/main",
  ])("exempts the index-like file %s", (id) => {
    expect(orphans([id])).toEqual([]);
  });

  it("exempts a module matched by an entry_points glob", () => {
    expect(
      orphans(["scripts/run.mjs", "app/other.py"], ["scripts/**"]),
    ).toEqual(["orphan:app/other.py"]);
  });

  it("reports a module imported only by itself", () => {
    expect(orphans(["a.py"], [], null, [["a.py", "a.py"]])).toEqual([
      "orphan:a.py",
    ]);
  });

  it("reports a module whose only importer is ignored", () => {
    expect(
      orphans(["vendor/v.py", "lib2/x.py"], [], "ignore: [vendor/**]\n", [
        ["vendor/v.py", "lib2/x.py"],
      ]),
    ).toEqual(["orphan:lib2/x.py"]);
  });
});

describe("policy_drift", () => {
  const POLICY =
    "components:\n  domain: app/domain/**\n  ports: app/ports/**\n";

  it("reports exactly the failing entry and the uncovered folder", () => {
    const found = policyDriftFindings(
      [
        scanOf(
          [["app/domain/a.py", "app/misc/m.py"]],
          ["app/domain/a.py", "app/misc/m.py"],
        ),
      ],
      parsePolicy(POLICY),
    );

    expect(ids(found)).toEqual([
      "policy_drift:entry:app/ports/**",
      "policy_drift:folder:app/misc",
    ]);
    expect(found[0]?.evidence.modules).toEqual([]);
    expect(found[1]?.evidence.modules).toEqual(["app/misc/m.py"]);
    expect(found[1]?.summary).toBe(
      "folder app/misc holds 1 scanned modules that no component covers",
    );
  });

  it("reports a glob listed under two components once", () => {
    const found = policyDriftFindings(
      [scanOf([], ["x/a.py"])],
      parsePolicy("components:\n  one: gone/**\n  two: gone/**\n  c: x/**\n"),
    );

    expect(ids(found)).toEqual(["policy_drift:entry:gone/**"]);
    expect(found[0]?.summary).toContain("component one");
  });

  it("reports nothing without components or without a policy", () => {
    const scan = scanOf([], ["x/a.py"]);

    expect(policyDriftFindings([scan], parsePolicy("ignore: []\n"))).toEqual(
      [],
    );
    expect(policyDriftFindings([scan], null)).toEqual([]);
  });

  it("does not drift a glob matching a module in only one of two scans", () => {
    const found = policyDriftFindings(
      [scanOf([], ["app/domain/a.py"]), scanOf([], ["app/ports/p.py"])],
      parsePolicy(POLICY),
    );

    expect(found).toEqual([]);
  });
});

describe("structure settings", () => {
  const config = (yaml: string) => parseConfig(yaml);

  it("defaults every switch on with no entry points", () => {
    expect(resolveStructureSettings(null)).toEqual(DEFAULT_STRUCTURE_SETTINGS);
    expect(DEFAULT_STRUCTURE_SETTINGS.entry_points).toEqual([]);
    expect(
      resolveStructureSettings(config("sensors:\n  structure: off\n")),
    ).toBe("off");
  });

  it("reads warnings.orphan as a boolean or an object", () => {
    const resolve = (orphan: string) =>
      resolveStructureSettings(
        config(
          `sensors:\n  structure:\n    warnings:\n      orphan: ${orphan}\n`,
        ),
      ) as StructureSettings;

    expect(resolve("true")).toMatchObject({
      entry_points: [],
      warnings: { orphan: true },
    });
    expect(resolve("false")).toMatchObject({
      entry_points: [],
      warnings: { orphan: false },
    });
    expect(resolve("{ entry_points: [scripts/**] }")).toMatchObject({
      entry_points: ["scripts/**"],
      warnings: { orphan: true },
    });
  });

  it("records settings in key order", () => {
    const { document } = structureSensor(
      [scanOf([], ["a.py"])],
      null,
      DEFAULT_STRUCTURE_SETTINGS,
      CONTEXT,
    );

    expect(JSON.stringify(document.settings)).toBe(
      '{"hub_threshold":10,"entry_points":[],"warnings":{"cycle":true,"hub":true,"folder_cycle":true,"orphan":true,"policy_drift":true}}',
    );
    expect(document.sensor.version).toBe("2");
  });

  it("describes the settings with and without entry points", () => {
    const base =
      "hub_threshold 10, cycle on, hub on, folder_cycle on, orphan on, policy_drift on";

    expect(describeSettings(DEFAULT_STRUCTURE_SETTINGS)).toBe(base);
    expect(
      describeSettings({
        ...DEFAULT_STRUCTURE_SETTINGS,
        entry_points: ["a", "b"],
      }),
    ).toBe(`${base}, entry_points 2`);
  });

  it.each([
    ["folder_cycle", "folder_cycle:"],
    ["orphan", "orphan:"],
    ["policy_drift", "policy_drift:"],
  ] as const)("switching %s off removes only its kind", (name, prefix) => {
    const scan = scanOf(
      [
        ["a/x.py", "b/y.py"],
        ["b/y.py", "a/x.py"],
      ],
      ["c/lonely.py"],
    );
    const policy = parsePolicy("components:\n  a: a/**\n  gone: gone/**\n");
    const run = (settings: StructureSettings) =>
      ids(structureSensor([scan], policy, settings, CONTEXT).document.findings);
    const all = run(DEFAULT_STRUCTURE_SETTINGS);
    const off = run({
      ...DEFAULT_STRUCTURE_SETTINGS,
      warnings: { ...DEFAULT_STRUCTURE_SETTINGS.warnings, [name]: false },
    });

    expect(all.filter((id) => id.startsWith(prefix)).length).toBeGreaterThan(0);
    expect(off).toEqual(all.filter((id) => !id.startsWith(prefix)));
  });
});

describe("the config examples", () => {
  it("accepts the orphan object and rejects an empty glob", () => {
    const read = (path: string) =>
      readFileSync(join(REPO, "schema/config-examples", path), "utf8");

    expect(() => parseConfig(read("valid/sensors.yaml"))).not.toThrow();
    expect(() =>
      parseConfig(read("invalid/sensors-orphan-bad-entry-points.yaml")),
    ).toThrow(InputError);
    expect(() =>
      parseConfig(
        "sensors:\n  structure:\n    warnings:\n      orphan: { extra: 1 }\n",
      ),
    ).toThrow(InputError);
  });
});

describe("fixtures/check-warnings", () => {
  it("yields exactly the four orphans and no folder cycle or drift", () => {
    const dir = join(REPO, "fixtures/check-warnings");
    const scan = validateScan(
      JSON.parse(readFileSync(join(dir, "scan.json"), "utf8")),
    );
    const policy = parsePolicy(
      readFileSync(join(dir, ".recognizer/policy.yaml"), "utf8"),
    );
    const { document } = structureSensor(
      [scan],
      policy,
      DEFAULT_STRUCTURE_SETTINGS,
      CONTEXT,
    );
    const found = ids(document.findings).filter(
      (id) =>
        id.startsWith("orphan:") ||
        id.startsWith("folder_cycle:") ||
        id.startsWith("policy_drift:"),
    );

    expect(found).toEqual([
      "orphan:app/adapters/audit.py",
      "orphan:app/adapters/clock.py",
      "orphan:app/adapters/sql.py",
      "orphan:app/application/report.py",
    ]);
  });
});
