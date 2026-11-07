import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config-parse.js";
import { InputError } from "../src/errors.js";
import {
  type FolderMeasures,
  type FolderMetrics,
  measureFolders,
} from "../src/folder-metrics.js";
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
  stableDependenciesFindings,
  unusedExportsFindings,
} from "../src/structure-warnings.js";
import {
  scanOf as foldersOf,
  WORKED,
  WORKED_EDGES,
} from "./folder-fixtures.js";
import { REPO } from "./helpers.js";

function scanOf(
  edges: [string, string][],
  modules: string[] = [],
  entryPoints: string[] = [],
) {
  const ids = new Set([...modules, ...edges.flat()]);

  return validateScan({
    schema_version: 6,
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
      .map((id) => ({
        id,
        language: "python",
        kind: "module",
        members: [],
        ...(entryPoints.includes(id) ? { entry_point: true } : {}),
      })),
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
      { hub_threshold: 10 },
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: "folder_cycle:a,b",
      kind: "folder_cycle",
      severity: "warning",
      principle: "no-cycles",
      fix_pattern: "break-folder-cycle",
      summary:
        "folders a and b import each other; removing 1 of 3 imports breaks the cycle",
    });
    expect(found[0]?.evidence.edges).toEqual([
      { from: "a/x.py", to: "b/y.py" },
      { from: "a/x2.py", to: "b/y.py" },
      { from: "b/y.py", to: "a/x.py" },
    ]);
    expect(found[0]?.evidence.modules).toEqual(["a/x.py", "a/x2.py", "b/y.py"]);
    expect(found[0]?.evidence.cuts).toEqual([{ from: "b/y.py", to: "a/x.py" }]);
    expect(found[0]?.evidence.split_candidates).toBeUndefined();
  });

  it("reports nothing for edges in one direction", () => {
    expect(
      folderCycleFindings(scanOf([["a/x.py", "b/y.py"]]), null, {
        hub_threshold: 10,
      }),
    ).toEqual([]);
  });

  it("reports a ring of three folders as one finding", () => {
    const ring = scanOf([
      ["a/x.py", "b/y.py"],
      ["b/y.py", "c/z.py"],
      ["c/z.py", "a/x.py"],
    ]);
    const found = folderCycleFindings(ring, null, { hub_threshold: 10 });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: "folder_cycle:a,b,c",
      summary:
        "3 folders import each other in a cycle; removing 1 of 3 imports breaks it",
    });
    expect(found[0]?.evidence.edges).toHaveLength(3);
    expect(found[0]?.evidence.cuts).toHaveLength(1);
  });

  it("names a split candidate in the summary and the evidence", () => {
    const hub = scanOf([
      ["a/x.py", "h/x.py"],
      ["b/x.py", "h/x.py"],
      ["h/x.py", "a/y.py"],
      ["h/y.py", "b/y.py"],
    ]);
    const found = folderCycleFindings(hub, null, { hub_threshold: 2 });

    expect(found).toHaveLength(1);
    expect(found[0]?.evidence.split_candidates).toEqual(["h"]);
    expect(found[0]?.summary).toContain(
      "and h is imported by and imports most of the cycle, so splitting it is likely the real fix",
    );
    expect(found[0]?.summary).toContain("removing 2 of 4 imports");
    expect(
      folderCycleFindings(hub, null, { hub_threshold: 3 })[0]?.evidence
        .split_candidates,
    ).toBeUndefined();
  });

  it("pairs an ancestor and a descendant folder", () => {
    const found = folderCycleFindings(
      scanOf([
        ["a/x.py", "a/b/y.py"],
        ["a/b/y.py", "a/x.py"],
      ]),
      null,
      { hub_threshold: 10 },
    );

    expect(ids(found)).toEqual(["folder_cycle:a,a/b"]);
  });

  it("leaves two modules of one folder to the module cycle", () => {
    const same = scanOf([
      ["a/x.py", "a/y.py"],
      ["a/y.py", "a/x.py"],
    ]);

    expect(folderCycleFindings(same, null, { hub_threshold: 10 })).toEqual([]);
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

  it("skips a module the scan flags as an entry point", () => {
    const flagged = orphanFindings(
      scanOf([], ["app/run.py", "app/plain.py"], ["app/run.py"]),
      null,
      [],
    );
    const unflagged = orphanFindings(scanOf([], ["app/run.py"]), null, []);

    expect(ids(flagged)).toEqual(["orphan:app/plain.py"]);
    expect(ids(unflagged)).toEqual(["orphan:app/run.py"]);
  });

  it("still exempts configured globs and policy literals beside a flag", () => {
    expect(
      orphans(
        ["app/run.py", "cli/x.py", "app/lit.py"],
        ["cli/**"],
        "components:\n  wired:\n    - app/lit.py\n",
      ),
    ).toEqual(["orphan:app/run.py"]);
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

describe("orphan actual_of", () => {
  const scanWith = (
    edges: [string, string][],
    modules: string[],
    actualOf: Record<string, string[]>,
  ) => {
    const base = scanOf(edges, modules);

    return {
      ...base,
      modules: base.modules.map((module) =>
        actualOf[module.id] === undefined
          ? module
          : { ...module, actual_of: actualOf[module.id] },
      ),
    };
  };
  const orphansOf = (
    edges: [string, string][],
    modules: string[],
    actualOf: Record<string, string[]>,
    policy: string | null = null,
  ) =>
    ids(
      orphanFindings(
        scanWith(edges, modules, actualOf),
        policy === null ? null : parsePolicy(policy),
        [],
      ),
    );

  it("reaches an actual file whose expect file is imported", () => {
    expect(
      orphansOf([["u.kt", "c.kt"]], ["u.kt", "c.kt", "j.kt"], {
        "j.kt": ["c.kt"],
      }),
    ).toEqual(["orphan:u.kt"]);
  });

  it("reports an actual file and its expect file when nothing imports the expect file", () => {
    expect(orphansOf([], ["c.kt", "j.kt"], { "j.kt": ["c.kt"] })).toEqual([
      "orphan:c.kt",
      "orphan:j.kt",
    ]);
  });

  it("passes reachability down a chain of actuals", () => {
    expect(
      orphansOf([["u.kt", "c.kt"]], ["u.kt", "a.kt", "b.kt", "c.kt"], {
        "a.kt": ["b.kt"],
        "b.kt": ["c.kt"],
      }),
    ).toEqual(["orphan:u.kt"]);
  });

  it("reaches nothing through an id absent from the scan", () => {
    expect(orphansOf([], ["j.kt"], { "j.kt": ["gone.kt"] })).toEqual([
      "orphan:j.kt",
    ]);
  });

  it("reaches nothing through a policy-ignored expect file", () => {
    expect(
      orphansOf(
        [["u.kt", "vendor/c.kt"]],
        ["u.kt", "vendor/c.kt", "j.kt"],
        { "j.kt": ["vendor/c.kt"] },
        "ignore: [vendor/**]\n",
      ),
    ).toEqual(["orphan:j.kt", "orphan:u.kt"]);
  });

  it("gives today's orphans for a scan without actual_of", () => {
    expect(orphansOf([], ["c.kt", "j.kt"], {})).toEqual([
      "orphan:c.kt",
      "orphan:j.kt",
    ]);
  });

  it("reaches an actual file when one of two expect files is imported", () => {
    expect(
      orphansOf([["u.kt", "c1.kt"]], ["u.kt", "c1.kt", "c2.kt", "j.kt"], {
        "j.kt": ["c1.kt", "c2.kt"],
      }),
    ).toEqual(["orphan:c2.kt", "orphan:u.kt"]);
  });

  it("reports an actual file whose two expect files are both unreached", () => {
    expect(
      orphansOf([], ["c1.kt", "c2.kt", "j.kt"], {
        "j.kt": ["c1.kt", "c2.kt"],
      }),
    ).toContain("orphan:j.kt");
  });

  it("ends the summary of a .kt and a .cs orphan with the library hint and leaves .py alone", () => {
    const kt = orphanFindings(
      scanOf([], ["a/M.kt", "a/N.cs", "a/p.py"]),
      null,
      [],
    );
    const hint =
      "; a library can list its public API in warnings.orphan.entry_points";

    expect(kt.map((finding) => finding.summary)).toEqual([
      `a/M.kt is imported by no module and is not an entry point${hint}`,
      `a/N.cs is imported by no module and is not an entry point${hint}`,
      "a/p.py is imported by no module and is not an entry point",
    ]);
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
      '{"hub_threshold":10,"instability_gap":0.2,"composition_roots":[],"entry_points":[],"warnings":{"cycle":true,"hub":true,"folder_cycle":true,"orphan":true,"policy_drift":true,"stable_dependencies":true,"unused_exports":false}}',
    );
    expect(document.sensor.version).toBe("11");
  });

  it("describes the settings with and without entry points", () => {
    const base =
      "hub_threshold 10, instability_gap 0.2, cycle on, hub on, folder_cycle on, orphan on, policy_drift on, stable_dependencies on, unused_exports off";

    expect(describeSettings(DEFAULT_STRUCTURE_SETTINGS)).toBe(base);
    expect(
      describeSettings({
        ...DEFAULT_STRUCTURE_SETTINGS,
        entry_points: ["a", "b"],
      }),
    ).toBe(`${base}, entry_points 2`);
    expect(
      describeSettings({
        ...DEFAULT_STRUCTURE_SETTINGS,
        composition_roots: ["a", "b", "c"],
      }),
    ).toBe(`${base}, composition_roots 3`);
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
  it("yields exactly the four orphans, the one three-folder cycle and no drift", () => {
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
      "folder_cycle:app/adapters,app/application,app/domain",
      "orphan:app/adapters/audit.py",
      "orphan:app/adapters/clock.py",
      "orphan:app/adapters/sql.py",
      "orphan:app/application/report.py",
    ]);
  });
});

describe("stable_dependencies", () => {
  const STRICT = { min_gap: 0, composition_roots: [] as string[] };

  const held = (
    instabilities: [string, number | null][],
    pairs: [string, string][],
  ): FolderMeasures => ({
    rows: instabilities.map(
      ([id, instability]): FolderMetrics => ({
        id,
        modules: 1,
        afferent: 1,
        efferent: 1,
        instability,
        exported_members: 0,
        abstract_members: 0,
        abstractness: null,
        distance: null,
      }),
    ),
    between: new Map(
      pairs.map(([source, target]) => [
        `${source}\0${target}`,
        [{ from: `${source}/m.ts`, to: `${target}/m.ts` }],
      ]),
    ),
    modulesOf: new Map(),
  });

  const fires = (
    instabilities: [string, number | null][],
    pairs: [string, string][],
    options: { min_gap: number; composition_roots: string[] },
  ) => ids(stableDependenciesFindings(held(instabilities, pairs), options));

  it("flags the less stable target with its full evidence", () => {
    const found = stableDependenciesFindings(
      held(
        [
          ["app/domain", 0.5],
          ["app/util", 0.6667],
        ],
        [["app/domain", "app/util"]],
      ),
      STRICT,
    );

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
          modules: ["app/domain/m.ts", "app/util/m.ts"],
          edges: [{ from: "app/domain/m.ts", to: "app/util/m.ts" }],
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
      STRICT,
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
      STRICT,
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
      STRICT,
    );

    expect(ids(found)).toEqual(["stable_dependencies:c->a"]);
  });

  it("makes no pair from foreign edges", () => {
    const found = stableDependenciesFindings(
      measureFolders(
        [foldersOf([{ id: "a/x.ts" }], [["a/x.ts", "foreign:q"]])],
        null,
      ),
      STRICT,
    );

    expect(found).toEqual([]);
  });

  it("gives the worked example no finding now that foreign imports add nothing", () => {
    const measures = measureFolders([foldersOf(WORKED, WORKED_EDGES)], null);

    expect(stableDependenciesFindings(measures, STRICT)).toEqual([]);
  });

  it("fires when the gap is exactly the setting, floating point included", () => {
    const rows: [string, number][] = [
      ["a", 0.5],
      ["b", 0.7],
    ];

    expect(
      fires(rows, [["a", "b"]], { min_gap: 0.2, composition_roots: [] }),
    ).toEqual(["stable_dependencies:a->b"]);
  });

  it("does not fire when the gap is under the setting", () => {
    expect(
      fires(
        [
          ["a", 0.5],
          ["b", 0.69],
        ],
        [["a", "b"]],
        { min_gap: 0.2, composition_roots: [] },
      ),
    ).toEqual([]);
  });

  it("fires on the 0.5 to 0.6667 pair at gap 0 and at exactly 0.1667, not at 0.2", () => {
    const rows: [string, number][] = [
      ["a", 0.5],
      ["b", 0.6667],
    ];
    const pairs: [string, string][] = [["a", "b"]];

    expect(fires(rows, pairs, { min_gap: 0.2, composition_roots: [] })).toEqual(
      [],
    );
    expect(fires(rows, pairs, STRICT)).toEqual(["stable_dependencies:a->b"]);
    expect(
      fires(rows, pairs, { min_gap: 0.1667, composition_roots: [] }),
    ).toEqual(["stable_dependencies:a->b"]);
  });

  it("still needs the target strictly less stable at a gap of 0", () => {
    expect(
      fires(
        [
          ["a", 0.5],
          ["b", 0.5],
          ["c", 0.6],
        ],
        [
          ["a", "b"],
          ["c", "a"],
        ],
        STRICT,
      ),
    ).toEqual([]);
  });

  it("exempts a named root as the depending side and keeps findings that point at it", () => {
    const rows: [string, number][] = [
      ["root", 0.4],
      ["other", 0.4],
      ["lib", 0.9],
      ["leaf", 0.1],
    ];
    const pairs: [string, string][] = [
      ["root", "lib"],
      ["other", "lib"],
      ["leaf", "root"],
    ];

    expect(
      fires(rows, pairs, { min_gap: 0.2, composition_roots: ["root"] }),
    ).toEqual([
      "stable_dependencies:leaf->root",
      "stable_dependencies:other->lib",
    ]);
  });

  it("matches a composition root by glob, and . for the top-level folder", () => {
    const rows: [string, number][] = [
      ["app/wiring", 0.2],
      [".", 0.2],
      ["lib", 0.9],
    ];
    const pairs: [string, string][] = [
      ["app/wiring", "lib"],
      [".", "lib"],
    ];

    expect(
      fires(rows, pairs, { min_gap: 0.2, composition_roots: ["app/**"] }),
    ).toEqual(["stable_dependencies:.->lib"]);
    expect(
      fires(rows, pairs, { min_gap: 0.2, composition_roots: ["."] }),
    ).toEqual(["stable_dependencies:app/wiring->lib"]);
  });
});

describe("retired stable_abstractions finding", () => {
  const scan = foldersOf(WORKED, WORKED_EDGES);

  it("reports none on the worked example and keeps the folder numbers", () => {
    const { document, folder_metrics } = structureSensor(
      [scan],
      null,
      DEFAULT_STRUCTURE_SETTINGS,
      CONTEXT,
    );

    expect(
      document.findings.filter(
        (finding) => finding.kind === "stable_abstractions",
      ),
    ).toEqual([]);
    expect(
      folder_metrics.find((row) => row.id === "app/contracts"),
    ).toMatchObject({ abstractness: 1, instability: null, distance: null });
    expect(
      folder_metrics.filter((row) => (row.distance ?? 0) > 0.3).length,
    ).toBeGreaterThan(0);
  });
});

describe("switches for the package metric warnings", () => {
  const scan = foldersOf(
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
  );

  const run = (deps: boolean) =>
    structureSensor(
      [scan],
      null,
      {
        ...DEFAULT_STRUCTURE_SETTINGS,
        instability_gap: 0,
        warnings: {
          cycle: false,
          hub: false,
          folder_cycle: false,
          orphan: false,
          policy_drift: false,
          stable_dependencies: deps,
          unused_exports: false,
        },
      },
      CONTEXT,
    );

  it("keeps folder metrics whatever the switches say", () => {
    const both = run(true);
    const none = run(false);

    expect(none.document.findings).toEqual([]);
    expect(none.folder_metrics).toEqual(both.folder_metrics);
    expect(both.folder_metrics.map((row) => row.id)).toEqual(
      [...both.folder_metrics.map((row) => row.id)].sort(),
    );
  });

  it("switches stable dependencies off on its own", () => {
    expect(ids(run(false).document.findings)).toEqual([]);
    expect(ids(run(true).document.findings)).toEqual([
      "stable_dependencies:c->a",
    ]);
  });
});

describe("settings for the package metrics", () => {
  const resolve = (yaml: string) =>
    resolveStructureSettings(parseConfig(yaml), undefined);

  it("defaults the switch", () => {
    expect(resolveStructureSettings(null)).toMatchObject({
      warnings: { stable_dependencies: true },
    });
  });

  it("reads the configured values", () => {
    expect(
      resolve(
        "sensors:\n  structure:\n    warnings: { stable_dependencies: false }\n",
      ),
    ).toMatchObject({ warnings: { stable_dependencies: false } });
  });

  it("accepts and ignores the retired keys", () => {
    const retired = resolve(
      readFileSync(
        join(
          REPO,
          "schema",
          "config-examples",
          "valid",
          "sensors-retired-keys.yaml",
        ),
        "utf8",
      ),
    );
    const bare = resolve(
      "sensors:\n  structure:\n    hub_threshold: 6\n    warnings: { hub: false }\n",
    );

    expect(retired).toEqual(bare);
    expect(retired).not.toHaveProperty("distance_threshold");

    const run = (settings: typeof retired) =>
      structureSensor(
        [foldersOf(WORKED, WORKED_EDGES)],
        null,
        settings as StructureSettings,
        CONTEXT,
      ).document.findings;

    expect(run(retired)).toEqual(run(bare));
  });

  it("defaults instability_gap to 0.2 and composition_roots to none", () => {
    expect(
      resolve("sensors:\n  structure:\n    hub_threshold: 6\n"),
    ).toMatchObject({
      instability_gap: 0.2,
      composition_roots: [],
    });
    expect(resolveStructureSettings(null)).toMatchObject({
      instability_gap: 0.2,
      composition_roots: [],
    });
  });

  it("reads instability_gap and composition_roots from a config", () => {
    expect(
      resolve(
        "sensors:\n  structure:\n    instability_gap: 0\n    composition_roots: [cmd/**, .]\n",
      ),
    ).toMatchObject({ instability_gap: 0, composition_roots: ["cmd/**", "."] });
  });

  it("records both in the written settings", () => {
    const { document } = structureSensor(
      [scanOf([], ["a.py"])],
      null,
      {
        ...DEFAULT_STRUCTURE_SETTINGS,
        instability_gap: 0.3,
        composition_roots: ["cmd"],
      },
      CONTEXT,
    );

    expect(document.settings).toMatchObject({
      instability_gap: 0.3,
      composition_roots: ["cmd"],
    });
    expect(document.sensor.version).toBe("11");
  });

  it("honours a live key beside a retired one", () => {
    const settings = resolve(
      "sensors:\n  structure:\n    hub_threshold: 6\n    distance_threshold: 0.9\n",
    );

    expect(settings).toMatchObject({ hub_threshold: 6 });
    expect(settings).not.toHaveProperty("distance_threshold");
  });

  it.each([
    "sensors:\n  structure:\n    distance_threshold: 1.5\n",
    "sensors:\n  structure:\n    distance_threshold: -0.1\n",
    "sensors:\n  structure:\n    warnings: { stable_abstractions: 1 }\n",
    "sensors:\n  structure:\n    instability_gap: 1.5\n",
    "sensors:\n  structure:\n    instability_gap: -0.1\n",
    "sensors:\n  structure:\n    instability_gap: wide\n",
    "sensors:\n  structure:\n    composition_roots: ['']\n",
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

    expect(added).toEqual(["stable_dependencies:app/domain->app/adapters"]);
  });
});

interface UnusedModule {
  id: string;
  kind?: "module" | "package";
  exports?: string[];
  hidden?: string[];
  entry_point?: true;
}

interface UnusedEdge {
  from: string;
  to: string;
  kind?: "depends" | "inherits" | "implements";
  names?: string[];
  to_member?: string;
}

function unusedScan(modules: UnusedModule[], edges: UnusedEdge[] = []) {
  return validateScan({
    schema_version: 6,
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
    modules: modules.map((module) => ({
      id: module.id,
      language: "python",
      kind: module.kind ?? "module",
      ...(module.entry_point === true ? { entry_point: true } : {}),
      members: [
        ...(module.exports ?? []).map((name, index) => ({
          name,
          kind: "function",
          exported: true,
          line: 10 + index,
        })),
        ...(module.hidden ?? []).map((name) => ({
          name,
          kind: "function",
          exported: false,
          line: 1,
        })),
      ],
    })),
    edges: edges.map((edge, index) => ({
      from: edge.from,
      to: edge.to,
      kind: edge.kind ?? "depends",
      line: index + 1,
      ...(edge.names === undefined ? {} : { names: edge.names }),
      ...(edge.to_member === undefined
        ? {}
        : { member: "Sub", to_member: edge.to_member }),
    })),
    foreign: [],
  });
}

function unusedOf(
  modules: UnusedModule[],
  edges: UnusedEdge[] = [],
  entryPoints: string[] = [],
  policyYaml: string | null = null,
) {
  const found = unusedExportsFindings(
    unusedScan(modules, edges),
    policyYaml === null ? null : parsePolicy(policyYaml),
    entryPoints,
  );

  return Object.fromEntries(
    found.map((finding) => [
      finding.evidence.modules[0],
      (finding.evidence.members ?? []).map((member) => member.name),
    ]),
  );
}

describe("unused_exports", () => {
  it("skips a flagged module and still lists an unflagged one", () => {
    expect(
      unusedOf([
        { id: "shop/run.py", exports: ["go"], entry_point: true },
        { id: "shop/lib2.py", exports: ["go"] },
      ]),
    ).toEqual({ "shop/lib2.py": ["go"] });
  });

  it("lists only the unused name of a partly used module", () => {
    const found = unusedExportsFindings(
      unusedScan(
        [
          { id: "shop/a.py", exports: ["a", "b", "c"] },
          { id: "shop/b.py", exports: ["x"] },
        ],
        [
          { from: "shop/b.py", to: "shop/a.py", names: ["a"] },
          { from: "shop/b.py", to: "shop/a.py", names: ["b"] },
        ],
      ),
      null,
      [],
    );

    expect(ids(found)).toEqual([
      "unused_exports:shop/a.py",
      "unused_exports:shop/b.py",
    ]);
    expect(found[0]?.summary).toBe(
      "shop/a.py exports 1 name no other module imports: c",
    );
  });

  it("yields nothing when all are used and lists every name when none is", () => {
    expect(
      unusedOf(
        [
          { id: "shop/a.py", exports: ["a", "b", "c"] },
          { id: "shop/b.py", exports: ["x"] },
        ],
        [
          { from: "shop/x.py", to: "shop/a.py", names: ["a", "b", "c"] },
          { from: "shop/x.py", to: "shop/b.py", names: ["x"] },
        ],
      ),
    ).toEqual({});

    const [finding] = unusedExportsFindings(
      unusedScan([{ id: "shop/a.py", exports: ["c", "a", "b"] }]),
      null,
      [],
    );

    expect(finding?.summary).toBe(
      "shop/a.py exports 3 names no other module imports: a, b, c",
    );
    expect(finding?.evidence.members?.map((member) => member.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it.each([[undefined], [[]]])(
    "treats a depends edge with names %j as using every export",
    (names) => {
      expect(
        unusedOf(
          [{ id: "shop/a.py", exports: ["a", "b"] }],
          [{ from: "shop/b.py", to: "shop/a.py", names }],
        ),
      ).toEqual({});
    },
  );

  it.each(["inherits", "implements"] as const)(
    "treats an %s edge as using its to_member",
    (kind) => {
      expect(
        unusedOf(
          [{ id: "shop/a.py", exports: ["Base", "Other"] }],
          [{ from: "shop/b.py", to: "shop/a.py", kind, to_member: "Base" }],
        ),
      ).toEqual({ "shop/a.py": ["Other"] });
    },
  );

  it("uses a dotted member through its leading segment", () => {
    expect(
      unusedOf(
        [
          {
            id: "app/domain",
            kind: "package",
            exports: ["Currency", "Currency.Companion", "Money"],
          },
        ],
        [{ from: "app/other", to: "app/domain", names: ["Currency"] }],
      ),
    ).toEqual({ "app/domain": ["Money"] });
  });

  it("ignores self and foreign edges and non-exported members", () => {
    expect(
      unusedOf(
        [
          { id: "shop/a.py", exports: ["a"], hidden: ["h"] },
          { id: "shop/b.py", hidden: ["g"] },
        ],
        [
          { from: "shop/a.py", to: "shop/a.py", names: ["a"] },
          { from: "shop/b.py", to: "foreign:os", names: ["a"] },
        ],
      ),
    ).toEqual({ "shop/a.py": ["a"] });
  });

  it("reports only the names an __all__ lists, never the module's other public functions", () => {
    expect(
      unusedOf([
        {
          id: "shop/application/summary.py",
          exports: ["summarise"],
          hidden: ["detail"],
        },
      ]),
    ).toEqual({ "shop/application/summary.py": ["summarise"] });

    expect(
      unusedOf(
        [
          {
            id: "shop/application/summary.py",
            exports: ["summarise"],
            hidden: ["detail"],
          },
        ],
        [
          {
            from: "shop/b.py",
            to: "shop/application/summary.py",
            names: ["summarise"],
          },
        ],
      ),
    ).toEqual({});
  });

  it.each([
    "shop/tests/helper.py",
    "shop/test_x.py",
    "api/src/x.spec.ts",
    "app/FooTest.kt",
    "api/src/index.ts",
    "shop/src/lib.rs",
    "src/main/App.kt",
  ])("never reports the skipped module %s", (id) => {
    expect(unusedOf([{ id, exports: ["a"] }], [], ["src/main/**"])).toEqual({});
  });

  it("matches an entry point glob exactly", () => {
    expect(
      unusedOf(
        [
          { id: "src/main/App.kt", exports: ["a"] },
          { id: "src/mainline/App.kt", exports: ["b"] },
        ],
        [],
        ["src/main/**"],
      ),
    ).toEqual({ "src/mainline/App.kt": ["b"] });
  });

  it("gives a module the file and lines, and a package neither", () => {
    const [module] = unusedExportsFindings(
      unusedScan([{ id: "shop/a.py", exports: ["a"] }]),
      null,
      [],
    );
    const [pkg] = unusedExportsFindings(
      unusedScan([{ id: "app/domain", kind: "package", exports: ["Zed"] }]),
      null,
      [],
    );

    expect(module).toMatchObject({
      id: "unused_exports:shop/a.py",
      kind: "unused_exports",
      severity: "warning",
      principle: "export-only-what-is-used",
      fix_pattern: "narrow-exports",
    });
    expect(module?.evidence.members).toEqual([
      { module: "shop/a.py", name: "a", file: "shop/a.py", lines: [10, 10] },
    ]);
    expect(pkg?.evidence.members).toEqual([
      { module: "app/domain", name: "Zed" },
    ]);
  });

  it("sorts findings by id", () => {
    const found = unusedExportsFindings(
      unusedScan([
        { id: "shop/z.py", exports: ["z"] },
        { id: "shop/a.py", exports: ["a"] },
      ]),
      null,
      [],
    );

    expect(ids(found)).toEqual([
      "unused_exports:shop/a.py",
      "unused_exports:shop/z.py",
    ]);
  });

  it("skips a module the policy names by a literal path", () => {
    expect(
      unusedOf(
        [{ id: "app/cli.py", exports: ["a"] }],
        [],
        [],
        "components:\n  entry: [app/cli.py]\n",
      ),
    ).toEqual({});
  });

  it("drops an ignored module and its edges", () => {
    expect(
      unusedOf(
        [
          { id: "vendor/v.py", exports: ["v"] },
          { id: "lib/x.py", exports: ["x"] },
        ],
        [{ from: "vendor/v.py", to: "lib/x.py", names: ["x"] }],
        [],
        "ignore: [vendor/**]\n",
      ),
    ).toEqual({ "lib/x.py": ["x"] });
  });

  it("reports exactly the partly used and the wholly unused modules", () => {
    expect(
      unusedOf(
        [
          { id: "m/one.py", exports: ["used", "spare"] },
          { id: "m/two.py", exports: ["caller"] },
          { id: "m/three.py", exports: ["p", "q"] },
        ],
        [{ from: "m/two.py", to: "m/one.py", names: ["used"] }],
      ),
    ).toEqual({
      "m/one.py": ["spare"],
      "m/two.py": ["caller"],
      "m/three.py": ["p", "q"],
    });
  });

  it("is off by default and on when switched", () => {
    const scan = unusedScan([{ id: "shop/a.py", exports: ["a"] }]);
    const off = structureSensor(
      [scan],
      null,
      DEFAULT_STRUCTURE_SETTINGS,
      CONTEXT,
    );
    const on = structureSensor(
      [scan],
      null,
      {
        ...DEFAULT_STRUCTURE_SETTINGS,
        warnings: {
          ...DEFAULT_STRUCTURE_SETTINGS.warnings,
          unused_exports: true,
        },
      },
      CONTEXT,
    );

    expect(ids(off.document.findings)).not.toContain(
      "unused_exports:shop/a.py",
    );
    expect(off.document.settings.warnings).toMatchObject({
      unused_exports: false,
    });
    expect(ids(on.document.findings)).toContain("unused_exports:shop/a.py");
  });

  it("resolves absent, true and false", () => {
    const resolve = (yaml: string) =>
      resolveStructureSettings(parseConfig(yaml), undefined);
    const switched = (value: string) =>
      (
        resolve(
          `sensors:\n  structure:\n    warnings: { unused_exports: ${value} }\n`,
        ) as StructureSettings
      ).warnings.unused_exports;

    expect(
      (resolveStructureSettings(null) as StructureSettings).warnings
        .unused_exports,
    ).toBe(false);
    expect(switched("true")).toBe(true);
    expect(switched("false")).toBe(false);
    expect(() =>
      parseConfig(
        'sensors:\n  structure:\n    warnings: { unused_exports: "yes" }\n',
      ),
    ).toThrow(InputError);
  });

  it("prints the switch after stable_dependencies", () => {
    const base =
      "hub_threshold 10, instability_gap 0.2, cycle on, hub on, folder_cycle on, orphan on, policy_drift on, stable_dependencies on";

    expect(
      describeSettings({
        ...DEFAULT_STRUCTURE_SETTINGS,
        warnings: {
          ...DEFAULT_STRUCTURE_SETTINGS.warnings,
          unused_exports: true,
        },
        entry_points: ["a"],
      }),
    ).toBe(`${base}, unused_exports on, entry_points 1`);
  });

  it("gives the known exports of the committed fixture scans", () => {
    const expected: Record<string, Record<string, string[]>> = {
      python: {
        "shop/adapters/special_store.py": ["SpecialStore"],
        "shop/application/lookup.py": ["lookup"],
        "shop/application/place.py": ["place"],
        "shop/application/refund.py": ["refund"],
      },
      typescript: {
        "api/src/cache.ts": ["cached"],
        "api/src/place.ts": ["place"],
      },
      kotlin: {
        "app/src/main/kotlin/shop/clients/PaymentClient.kt": ["PaymentClient"],
        "app/src/main/kotlin/shop/domain/Currency.kt": [
          "Currency",
          "Currency.Companion",
        ],
        "app/src/main/kotlin/shop/persistence/JdbcOrderStore.kt": [
          "JdbcOrderStore",
        ],
        "app/src/main/kotlin/shop/web/OrderController.kt": ["OrderController"],
      },
      rust: {},
    };

    for (const [language, names] of Object.entries(expected)) {
      const scan = validateScan(
        JSON.parse(
          readFileSync(
            join(REPO, "fixtures", language, "expected-scan.json"),
            "utf8",
          ),
        ),
      );
      const found = unusedExportsFindings(scan, null, []);

      expect(
        Object.fromEntries(
          found.map((finding) => [
            finding.evidence.modules[0],
            (finding.evidence.members ?? []).map((member) => member.name),
          ]),
        ),
      ).toEqual(names);
    }
  });
});

describe("the former unused-exports short form", () => {
  it.each([
    "sensors:\n  unused-exports: {}\n",
    'sensors:\n  unused-exports: { entry_points: ["a"] }\n',
  ])("is rejected naming its path: %j", (yaml) => {
    let thrown: unknown;

    try {
      parseConfig(yaml);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(InputError);
    expect((thrown as InputError).messages.join("\n")).toContain(
      "config/sensors/unused-exports",
    );
  });

  it("still accepts the command form", () => {
    const config = parseConfig(
      "sensors:\n  unused-exports:\n    command: [node, run.mjs]\n",
    );

    expect(config.sensors?.["unused-exports"]).toEqual({
      command: ["node", "run.mjs"],
    });
  });
});
