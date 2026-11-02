import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config-parse.js";
import { InputError } from "../src/errors.js";
import { measureFolders } from "../src/folder-metrics.js";
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
  stableAbstractionsFindings,
  stableDependenciesFindings,
} from "../src/structure-warnings.js";
import {
  scanOf as foldersOf,
  type Spec,
  WORKED,
  WORKED_EDGES,
} from "./folder-fixtures.js";
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
      '{"hub_threshold":10,"distance_threshold":0.3,"entry_points":[],"warnings":{"cycle":true,"hub":true,"folder_cycle":true,"orphan":true,"policy_drift":true,"stable_dependencies":true,"stable_abstractions":true}}',
    );
    expect(document.sensor.version).toBe("3");
  });

  it("describes the settings with and without entry points", () => {
    const base =
      "hub_threshold 10, distance_threshold 0.3, cycle on, hub on, folder_cycle on, orphan on, policy_drift on, stable_dependencies on, stable_abstractions on";

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

describe("stable_dependencies", () => {
  const worked = () => measureFolders([foldersOf(WORKED, WORKED_EDGES)], null);

  it("flags only the worked example's domain to util edge", () => {
    const found = stableDependenciesFindings(worked());

    expect(found).toEqual([
      {
        id: "stable_dependencies:app/domain->app/util",
        kind: "stable_dependencies",
        severity: "warning",
        principle: "dependencies-point-toward-stability",
        summary:
          "folder app/domain depends on folder app/util, which is less stable (instability 0.5 -> 0.6667)",
        fix_pattern: "depend-on-stabler-folder",
        evidence: {
          modules: ["app/domain/order.ts", "app/util/fmt.ts"],
          edges: [{ from: "app/domain/order.ts", to: "app/util/fmt.ts" }],
          measures: { source_instability: 0.5, target_instability: 0.6667 },
        },
      },
    ]);
  });

  it("does not warn when the instabilities are equal", () => {
    const found = stableDependenciesFindings(
      measureFolders(
        [
          foldersOf(
            [
              { id: "a/x.ts" },
              { id: "b/y.ts" },
              { id: "c/z.ts" },
              { id: "d/w.ts" },
            ],
            [
              ["a/x.ts", "b/y.ts"],
              ["c/z.ts", "a/x.ts"],
              ["b/y.ts", "d/w.ts"],
            ],
          ),
        ],
        null,
      ),
    );

    expect(found).toEqual([]);
  });

  it("warns in only one direction of a two-way pair", () => {
    const found = stableDependenciesFindings(
      measureFolders(
        [
          foldersOf(
            [{ id: "a/x.ts" }, { id: "b/y.ts" }, { id: "c/z.ts" }],
            [
              ["a/x.ts", "b/y.ts"],
              ["b/y.ts", "a/x.ts"],
              ["c/z.ts", "b/y.ts"],
            ],
          ),
        ],
        null,
      ),
    );

    expect(ids(found)).toEqual(["stable_dependencies:b->a"]);
  });

  it("warns on the ring edges whose target is less stable and no others", () => {
    const found = stableDependenciesFindings(
      measureFolders(
        [
          foldersOf(
            [
              { id: "a/x.ts" },
              { id: "a/x2.ts" },
              { id: "b/y.ts" },
              { id: "c/z.ts" },
              { id: "d/w.ts" },
            ],
            [
              ["a/x.ts", "b/y.ts"],
              ["b/y.ts", "c/z.ts"],
              ["c/z.ts", "a/x.ts"],
              ["a/x2.ts", "d/w.ts"],
            ],
          ),
        ],
        null,
      ),
    );

    expect(ids(found)).toEqual(["stable_dependencies:c->a"]);
  });

  it("makes no pair from foreign edges", () => {
    const found = stableDependenciesFindings(
      measureFolders(
        [foldersOf([{ id: "a/x.ts" }], [["a/x.ts", "foreign:q"]])],
        null,
      ),
    );

    expect(found).toEqual([]);
  });
});

describe("stable_abstractions", () => {
  const worked = () => measureFolders([foldersOf(WORKED, WORKED_EDGES)], null);

  it("names the zones in the worked example at the default threshold", () => {
    const found = stableAbstractionsFindings(worked(), 0.3);

    expect(ids(found)).toEqual([
      "stable_abstractions:app/contracts",
      "stable_abstractions:app/domain",
      "stable_abstractions:app/util",
    ]);
    expect(found[0]?.summary).toContain("useless zone");
    expect(found[1]?.summary).toContain("pain zone");
    expect(found[2]?.summary).toContain("pain zone");
    expect(found[0]).toMatchObject({
      principle: "stable-folders-are-abstract",
      fix_pattern: "move-toward-main-sequence",
      evidence: {
        modules: ["app/contracts/audit.ts"],
        measures: {
          afferent: 0,
          efferent: 1,
          instability: 1,
          abstractness: 1,
          distance: 1,
          threshold: 0.3,
        },
      },
    });
  });

  it("drops a folder exactly on the bound", () => {
    expect(ids(stableAbstractionsFindings(worked(), 0.3333))).toEqual([
      "stable_abstractions:app/contracts",
      "stable_abstractions:app/domain",
    ]);
    expect(ids(stableAbstractionsFindings(worked(), 0.5))).toEqual([
      "stable_abstractions:app/contracts",
    ]);
  });

  it("yields none when abstractness or instability is null", () => {
    const measures = measureFolders(
      [foldersOf([{ id: "a/x.ts" }, { id: "b/y.ts" }], [["a/x.ts", "b/y.ts"]])],
      null,
    );

    expect(stableAbstractionsFindings(measures, 0)).toEqual([]);
  });

  it("does not warn at distance 0.3 computed as 0.30000000000000004", () => {
    const importers: Spec[] = [];
    const edges: [string, string][] = [];

    for (let index = 0; index < 7; index += 1) {
      importers.push({ id: `f/m${index}.ts`, exports: ["class"] });
      edges.push([`f/m${index}.ts`, "foreign:q"]);
    }

    for (let index = 0; index < 3; index += 1) {
      importers.push({ id: `o/u${index}.ts` });
      edges.push([`o/u${index}.ts`, "f/m0.ts"]);
    }

    const measures = measureFolders([foldersOf(importers, edges)], null);
    const folder = measures.rows.find((row) => row.id === "f");

    expect(folder).toMatchObject({ afferent: 3, efferent: 7, distance: 0.3 });
    expect(stableAbstractionsFindings(measures, 0.3)).toEqual([]);
  });
});

describe("switches for the package metric warnings", () => {
  const scan = foldersOf(WORKED, WORKED_EDGES);

  const run = (deps: boolean, abstractions: boolean) =>
    structureSensor(
      [scan],
      null,
      {
        ...DEFAULT_STRUCTURE_SETTINGS,
        warnings: {
          cycle: false,
          hub: false,
          folder_cycle: false,
          orphan: false,
          policy_drift: false,
          stable_dependencies: deps,
          stable_abstractions: abstractions,
        },
      },
      CONTEXT,
    );

  it("keeps folder metrics whatever the switches say", () => {
    const both = run(true, true);
    const none = run(false, false);

    expect(none.document.findings).toEqual([]);
    expect(none.folder_metrics).toEqual(both.folder_metrics);
    expect(both.folder_metrics.map((row) => row.id)).toEqual(
      [...both.folder_metrics.map((row) => row.id)].sort(),
    );
  });

  it("switches each kind off on its own", () => {
    expect(
      ids(run(false, true).document.findings).every((id) =>
        id.startsWith("stable_abstractions:"),
      ),
    ).toBe(true);
    expect(ids(run(true, false).document.findings)).toEqual([
      "stable_dependencies:app/domain->app/util",
    ]);
  });
});

describe("settings for the package metrics", () => {
  const resolve = (yaml: string) =>
    resolveStructureSettings(parseConfig(yaml), undefined);

  it("defaults the threshold and both switches", () => {
    expect(resolveStructureSettings(null)).toMatchObject({
      distance_threshold: 0.3,
      warnings: { stable_dependencies: true, stable_abstractions: true },
    });
  });

  it("reads the configured values", () => {
    expect(
      resolve(
        "sensors:\n  structure:\n    distance_threshold: 0.5\n    warnings: { stable_dependencies: false }\n",
      ),
    ).toMatchObject({
      distance_threshold: 0.5,
      warnings: { stable_dependencies: false, stable_abstractions: true },
    });
  });

  it.each([
    "sensors:\n  structure:\n    distance_threshold: 1.5\n",
    "sensors:\n  structure:\n    distance_threshold: -0.1\n",
    "sensors:\n  structure:\n    warnings: { stable_abstractions: 1 }\n",
  ])("rejects %j", (yaml) => {
    expect(() => parseConfig(yaml)).toThrow(InputError);
  });
});

describe("real committed content", () => {
  it("measures fixtures/check-warnings", () => {
    const dir = join(REPO, "fixtures", "check-warnings");
    const scan = validateScan(
      JSON.parse(readFileSync(join(dir, "scan.json"), "utf8")),
    );
    const policy = parsePolicy(
      readFileSync(join(dir, ".recognizer", "policy.yaml"), "utf8"),
    );
    const result = structureSensor(
      [scan],
      policy,
      DEFAULT_STRUCTURE_SETTINGS,
      CONTEXT,
    );

    expect(
      result.folder_metrics.map(
        ({
          id,
          modules,
          afferent,
          efferent,
          instability,
          abstractness,
          distance,
        }) => ({
          id,
          modules,
          afferent,
          efferent,
          instability,
          abstractness,
          distance,
        }),
      ),
    ).toEqual([
      {
        id: "app/adapters",
        modules: 4,
        afferent: 1,
        efferent: 4,
        instability: 0.8,
        abstractness: null,
        distance: null,
      },
      {
        id: "app/application",
        modules: 2,
        afferent: 2,
        efferent: 1,
        instability: 0.3333,
        abstractness: null,
        distance: null,
      },
      {
        id: "app/domain",
        modules: 2,
        afferent: 1,
        efferent: 1,
        instability: 0.5,
        abstractness: null,
        distance: null,
      },
      {
        id: "app/ports",
        modules: 1,
        afferent: 3,
        efferent: 0,
        instability: 0,
        abstractness: null,
        distance: null,
      },
    ]);

    const added = ids(result.document.findings).filter((id) =>
      id.startsWith("stable_"),
    );

    expect(added).toEqual([
      "stable_dependencies:app/application->app/domain",
      "stable_dependencies:app/domain->app/adapters",
    ]);
  });
});
