import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config-parse.js";
import { InputError } from "../src/errors.js";
import { parsePolicy, validateScan } from "../src/index.js";
import { policyProblems } from "../src/policy-problems.js";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  describeSettings,
  resolveStructureSettings,
  type StructureSettings,
  structureSensor,
} from "../src/structure-sensor.js";
import {
  orphanFindings,
  unusedExportsFindings,
} from "../src/structure-warnings.js";
import {
  scanOf as foldersOf,
  WORKED,
  WORKED_EDGES,
} from "./folder-fixtures.js";
import { REPO } from "./helpers.js";
import { scanOf } from "./scan-of.js";

const CONTEXT = { commit: "abc", modified: false };

function ids(findings: { id: string }[]) {
  return findings.map((finding) => finding.id);
}

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
        "app/plain.py is imported by no module and is not an entry point; a library can list its public API in warnings.orphan.entry_points",
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
  ])("reports the former index-like file %s as an orphan", (id) => {
    expect(orphans([id])).toEqual([`orphan:${id}`]);
  });

  it("reports an index file next to an exempt one and keeps the hint", () => {
    expect(orphans(["app/index.ts", "app/other.py"], ["app/other.py"])).toEqual(
      ["orphan:app/index.ts"],
    );
    expect(
      orphanFindings(scanOf([], ["app/index.ts"]), null, [])[0]?.summary,
    ).toMatch(/entry_points$/);
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

  it("ends the summary of every orphan with the library hint", () => {
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
      `a/p.py is imported by no module and is not an entry point${hint}`,
    ]);
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
      '{"entry_points":[],"warnings":{"cycle":true,"orphan":true,"unused_exports":false}}',
    );
    expect(document.sensor.version).toBe("14");
  });

  it("describes the settings with and without entry points", () => {
    const base = "cycle on, orphan on, unused_exports off";

    expect(describeSettings(DEFAULT_STRUCTURE_SETTINGS)).toBe(base);
    expect(
      describeSettings({
        ...DEFAULT_STRUCTURE_SETTINGS,
        entry_points: ["a", "b"],
      }),
    ).toBe(`${base}, entry_points 2`);
  });

  it.each([["orphan", "orphan:"]] as const)(
    "switching %s off removes only its kind",
    (name, prefix) => {
      const scan = scanOf(
        [
          ["a/x.py", "b/y.py"],
          ["b/y.py", "a/x.py"],
        ],
        ["c/lonely.py"],
      );
      const policy = parsePolicy("components:\n  a: a/**\n  gone: gone/**\n");
      const run = (settings: StructureSettings) =>
        ids(
          structureSensor([scan], policy, settings, CONTEXT).document.findings,
        );
      const all = run(DEFAULT_STRUCTURE_SETTINGS);
      const off = run({
        ...DEFAULT_STRUCTURE_SETTINGS,
        warnings: { ...DEFAULT_STRUCTURE_SETTINGS.warnings, [name]: false },
      });

      expect(all.filter((id) => id.startsWith(prefix)).length).toBeGreaterThan(
        0,
      );
      expect(off).toEqual(all.filter((id) => !id.startsWith(prefix)));
    },
  );
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

describe("the removed hub keys", () => {
  it.each([
    ["hub_threshold", "sensors:\n  structure:\n    hub_threshold: 6\n"],
    ["hub_threshold", "sensors:\n  structure:\n    hub_threshold: 0\n"],
    ["hub", "sensors:\n  structure:\n    warnings:\n      hub: true\n"],
    ["hub", "sensors:\n  structure:\n    warnings:\n      hub: false\n"],
  ])("refuses %s in %j and says it was removed", (key, text) => {
    expect(() => parseConfig(text)).toThrow(InputError);
    expect(() => parseConfig(text)).toThrow(
      new RegExp(`structure/(warnings/)?${key} was removed`),
    );
  });

  it("carries neither key in the defaults, the description or the document", () => {
    const { document } = structureSensor(
      [scanOf([], ["a.py"])],
      null,
      DEFAULT_STRUCTURE_SETTINGS,
      CONTEXT,
    );
    const settings = document.settings as {
      warnings: Record<string, unknown>;
    };

    expect(Object.keys(settings)[0]).toBe("entry_points");
    expect(Object.keys(settings.warnings)).toEqual([
      "cycle",
      "orphan",
      "unused_exports",
    ]);
    expect(
      JSON.stringify([
        DEFAULT_STRUCTURE_SETTINGS,
        describeSettings(DEFAULT_STRUCTURE_SETTINGS),
        settings,
      ]),
    ).not.toMatch(/hub/);
  });
});

describe("the removed folder_cycle warning", () => {
  it.each(["true", "false"])(
    "refuses a config that sets folder_cycle: %s and says it was removed",
    (value) => {
      const text = `sensors:\n  structure:\n    warnings:\n      folder_cycle: ${value}\n`;

      expect(() => parseConfig(text)).toThrow(InputError);
      expect(() => parseConfig(text)).toThrow(/folder_cycle was removed/);
    },
  );

  it("still refuses an unrelated unknown warning with the generic message", () => {
    const text =
      "sensors:\n  structure:\n    warnings:\n      not_a_warning: true\n";

    expect(() => parseConfig(text)).toThrow(InputError);
    expect(() => parseConfig(text)).not.toThrow(/was removed/);
    expect(() => parseConfig(text)).toThrow(/must NOT have additional/);
  });
});

describe("the removed policy_drift warning", () => {
  it.each(["true", "false"])(
    "refuses a config that sets policy_drift: %s and says it was removed",
    (value) => {
      const text = `sensors:\n  structure:\n    warnings:\n      policy_drift: ${value}\n`;

      expect(() => parseConfig(text)).toThrow(InputError);
      expect(() => parseConfig(text)).toThrow(/policy_drift was removed/);
    },
  );

  it("still refuses an unrelated unknown warning with the generic message", () => {
    const text =
      "sensors:\n  structure:\n    warnings:\n      not_a_warning: true\n";

    expect(() => parseConfig(text)).toThrow(/must NOT have additional/);
  });

  it("raises no policy_drift finding and records no such setting", () => {
    const scan = scanOf(
      [],
      ["app/domain/a.py", "app/misc/m.py"],
      ["app/domain/a.py", "app/misc/m.py"],
    );
    const policy = parsePolicy(
      "components:\n  domain: app/domain/**\n  ports: app/ports/**\n",
    );
    const { document } = structureSensor(
      [scan],
      policy,
      DEFAULT_STRUCTURE_SETTINGS,
      CONTEXT,
    );
    const warnings = (document.settings as { warnings: object }).warnings;

    expect(policyProblems([scan], policy).length).toBeGreaterThan(0);
    expect(
      document.findings.filter(
        (finding) =>
          finding.kind.startsWith("policy_drift") ||
          finding.id.startsWith("policy_drift"),
      ),
    ).toEqual([]);
    expect(Object.keys(warnings)).not.toContain("policy_drift");
  });
});

describe("the removed structure keys", () => {
  it.each([
    "sensors:\n  structure:\n    distance_threshold: 0.4\n",
    "sensors:\n  structure:\n    distance_threshold: 1.5\n",
    "sensors:\n  structure:\n    distance_threshold: 0.9\n",
  ])("refuses %j and says distance_threshold was removed", (text) => {
    expect(() => parseConfig(text)).toThrow(InputError);
    expect(() => parseConfig(text)).toThrow(/distance_threshold was removed/);
  });

  it.each(["true", "false", "1"])(
    "refuses warnings.stable_abstractions: %s and says it was removed",
    (value) => {
      const text = `sensors:\n  structure:\n    warnings:\n      stable_abstractions: ${value}\n`;

      expect(() => parseConfig(text)).toThrow(InputError);
      expect(() => parseConfig(text)).toThrow(
        /stable_abstractions was removed/,
      );
    },
  );
});

describe("fixtures/check-warnings", () => {
  it("yields exactly the four orphans", () => {
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
    const found = ids(document.findings).filter((id) =>
      id.startsWith("orphan:"),
    );

    expect(found).toEqual([
      "orphan:app/adapters/audit.py",
      "orphan:app/adapters/clock.py",
      "orphan:app/adapters/sql.py",
      "orphan:app/application/report.py",
    ]);
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

  const run = (on: boolean) =>
    structureSensor(
      [scan],
      null,
      {
        ...DEFAULT_STRUCTURE_SETTINGS,
        warnings: {
          cycle: on,
          orphan: on,
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
});

describe("the removed stable dependencies keys", () => {
  it.each([
    ["instability_gap", "sensors:\n  structure:\n    instability_gap: 0.3\n"],
    ["instability_gap", "sensors:\n  structure:\n    instability_gap: 1.5\n"],
    [
      "composition_roots",
      "sensors:\n  structure:\n    composition_roots: [cmd]\n",
    ],
    [
      "composition_roots",
      "sensors:\n  structure:\n    composition_roots: ['']\n",
    ],
    [
      "stable_dependencies",
      "sensors:\n  structure:\n    warnings:\n      stable_dependencies: true\n",
    ],
    [
      "stable_dependencies",
      "sensors:\n  structure:\n    warnings:\n      stable_dependencies: false\n",
    ],
  ])("refuses %s in %j and says it was removed", (key, text) => {
    expect(() => parseConfig(text)).toThrow(InputError);
    expect(() => parseConfig(text)).toThrow(
      new RegExp(`structure/(warnings/)?${key} was removed`),
    );
  });

  it.each([
    "sensors-retired-instability-gap.yaml",
    "sensors-retired-composition-roots.yaml",
    "sensors-retired-stable-dependencies.yaml",
    "sensors-retired-hub-threshold.yaml",
    "sensors-retired-hub.yaml",
  ])("refuses the example %s as removed", (name) => {
    const text = readFileSync(
      join(REPO, "schema/config-examples/invalid", name),
      "utf8",
    );

    expect(() => parseConfig(text)).toThrow(/was removed/);
  });

  it("carries none of the three in the defaults, the description or the document", () => {
    const { document } = structureSensor(
      [scanOf([], ["a.py"])],
      null,
      DEFAULT_STRUCTURE_SETTINGS,
      CONTEXT,
    );
    const settings = document.settings as Record<string, unknown>;
    const text = JSON.stringify([
      DEFAULT_STRUCTURE_SETTINGS,
      describeSettings(DEFAULT_STRUCTURE_SETTINGS),
      settings,
    ]);

    expect(Object.keys(settings)[0]).toBe("entry_points");
    expect(text).not.toMatch(
      /instability_gap|composition_roots|stable_dependencies/,
    );
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

    expect(
      ids(result.document.findings).filter((id) => id.startsWith("stable_")),
    ).toEqual([]);
  });
});

interface UnusedModule {
  id: string;
  kind?: "module" | "package";
  exports?: string[];
  hidden?: string[];
  entry_point?: true;
  actual_of?: string[];
}

interface UnusedCall {
  from: string;
  to: string;
}

interface UnusedEdge {
  from: string;
  to: string;
  kind?: "depends" | "inherits" | "implements";
  names?: string[];
  to_member?: string;
}

function unusedScan(
  modules: UnusedModule[],
  edges: UnusedEdge[] = [],
  calls: UnusedCall[] = [],
  testImports: { from: string; to: string; names?: string[] }[] = [],
  language = "python",
) {
  return validateScan({
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
    modules: modules.map((module) => ({
      id: module.id,
      language,
      kind: module.kind ?? "module",
      ...(module.entry_point === true ? { entry_point: true } : {}),
      ...(module.actual_of === undefined
        ? {}
        : { actual_of: module.actual_of }),
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
    ...(calls.length === 0
      ? {}
      : {
          calls: calls.map((call, index) => ({
            ...call,
            line: index + 1,
            how: "call",
          })),
        }),
    ...(testImports.length === 0 ? {} : { test_imports: testImports }),
    foreign: [],
  });
}

function unusedOf(
  modules: UnusedModule[],
  edges: UnusedEdge[] = [],
  entryPoints: string[] = [],
  policyYaml: string | null = null,
  calls: UnusedCall[] = [],
) {
  const found = unusedExportsFindings(
    unusedScan(modules, edges, calls),
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

const HINT =
  "; a library can list its public API in warnings.orphan.entry_points";

function unusedWithTests(
  exports: string[],
  testImports: { from: string; to: string; names?: string[] }[],
  id = "a/m.py",
  language = "python",
) {
  const found = unusedExportsFindings(
    unusedScan([{ id, exports }], [], [], testImports, language),
    null,
    [],
  );

  return found[0] as NonNullable<(typeof found)[number]>;
}

describe("unused_exports test-only names", () => {
  const imp = (from: string, names?: string[]) => ({
    from,
    to: "a/m.py",
    ...(names === undefined ? {} : { names }),
  });

  it("marks only the names a test imports, with sorted test files", () => {
    const finding = unusedWithTests(
      ["a", "b", "c"],
      [imp("t/test_z.py", ["b"]), imp("t/test_a.py", ["b"])],
    );

    expect(finding.evidence.members).toEqual([
      { module: "a/m.py", name: "a", file: "a/m.py", lines: [10, 10] },
      {
        module: "a/m.py",
        name: "b",
        file: "a/m.py",
        lines: [11, 11],
        test_files: ["t/test_a.py", "t/test_z.py"],
      },
      { module: "a/m.py", name: "c", file: "a/m.py", lines: [12, 12] },
    ]);
    expect(finding.summary).toBe(
      `a/m.py exports 3 names no other module imports: a, b, c; only tests import b (t/test_a.py, t/test_z.py), so if nothing outside the repository uses it, delete it with its tests${HINT}`,
    );
  });

  it("marks a dotted member through its leading segment", () => {
    const finding = unusedWithTests(["Foo.bar"], [imp("t/test_a.py", ["Foo"])]);

    expect(finding.evidence.members?.[0]?.test_files).toEqual(["t/test_a.py"]);
    expect(finding.summary).toContain(
      "only tests import Foo.bar (t/test_a.py), so if nothing outside the repository uses it, delete it with its tests",
    );
  });

  it("marks nothing for a test record with no names", () => {
    const withTests = unusedWithTests(["a", "b"], [imp("t/test_a.py")]);
    const without = unusedWithTests(["a", "b"], []);

    expect(withTests).toEqual(without);
    expect(withTests.summary).toBe(
      "a/m.py exports 2 names no other module imports: a, b",
    );
  });

  it("leaves a name used by a non-test module unlisted even when a test imports it", () => {
    const found = unusedExportsFindings(
      unusedScan(
        [
          { id: "a/m.py", exports: ["a", "b"] },
          { id: "a/user.py", exports: [] },
        ],
        [{ from: "a/user.py", to: "a/m.py", names: ["a"] }],
        [],
        [imp("t/test_a.py", ["a", "b"])],
      ),
      null,
      [],
    );

    expect(
      found[0]?.evidence.members?.map((member) => [
        member.name,
        member.test_files,
      ]),
    ).toEqual([["b", ["t/test_a.py"]]]);
  });

  it("marks every name and uses plural wording", () => {
    const finding = unusedWithTests(
      ["a", "b"],
      [imp("t/test_a.py", ["a", "b"])],
    );

    expect(finding.summary).toBe(
      `a/m.py exports 2 names no other module imports: a, b; only tests import a, b (t/test_a.py), so if nothing outside the repository uses them, delete them with their tests${HINT}`,
    );
  });

  it.each([
    [1, "t/test_0.py"],
    [3, "t/test_0.py, t/test_1.py, t/test_2.py"],
    [4, "t/test_0.py, t/test_1.py, t/test_2.py and 1 more"],
    [5, "t/test_0.py, t/test_1.py, t/test_2.py and 2 more"],
  ])("shows at most three test files for %i files", (count, shown) => {
    const finding = unusedWithTests(
      ["a"],
      Array.from({ length: count }, (_, at) => imp(`t/test_${at}.py`, ["a"])),
    );

    expect(finding.summary).toContain(`only tests import a (${shown}), so`);
  });

  it("leaves a Kotlin module with no test imports unchanged", () => {
    const finding = unusedWithTests(["a"], [], "a/M.kt", "kotlin");

    expect(finding.summary).toBe(
      "a/M.kt exports 1 name no other module imports: a",
    );
  });

  it("derives the marked count from the committed TypeScript scan", () => {
    const scan = validateScan(
      JSON.parse(
        readFileSync(
          join(REPO, "fixtures/typescript/expected-scan.json"),
          "utf8",
        ),
      ),
    );
    const found = unusedExportsFindings(scan, null, []);
    const members = found.flatMap((finding) => finding.evidence.members ?? []);
    const used = (name: string, names: string[]) =>
      names.includes(name) || names.includes(name.split(".", 1)[0] as string);
    const expected = members.filter((member) =>
      (scan.test_imports ?? []).some(
        (record) =>
          record.to === member.module && used(member.name, record.names ?? []),
      ),
    );

    expect(members.filter((member) => member.test_files !== undefined)).toEqual(
      expected,
    );

    for (const member of members) {
      for (const file of member.test_files ?? []) {
        expect(
          (scan.test_imports ?? []).some(
            (record) =>
              record.from === file &&
              record.to === member.module &&
              used(member.name, record.names ?? []),
          ),
        ).toBe(true);
      }
    }
  });

  it("marks nothing over the committed Python scan", () => {
    const raw = JSON.parse(
      readFileSync(join(REPO, "fixtures/python/expected-scan.json"), "utf8"),
    );
    const { test_imports: _dropped, ...stripped } = raw;
    const withTests = unusedExportsFindings(validateScan(raw), null, []);
    const without = unusedExportsFindings(validateScan(stripped), null, []);

    expect(withTests).toEqual(without);
  });
});

describe("unused_exports", () => {
  describe("actual files", () => {
    const expectFile = { id: "k/Expect.kt", exports: ["go", "helper"] };
    const actualFile = {
      id: "k/Expect.jvm.kt",
      exports: ["go"],
      actual_of: ["k/Expect.kt"],
    };

    it("clears an actual member whose expect member another member calls", () => {
      expect(
        unusedOf([expectFile, actualFile], [], [], null, [
          { from: "k/Expect.kt::helper", to: "k/Expect.kt::go" },
        ]),
      ).toEqual({ "k/Expect.kt": ["helper"] });
    });

    it("clears an actual member whose expect member an edge names", () => {
      expect(
        unusedOf(
          [expectFile, actualFile, { id: "k/User.kt", exports: ["u"] }],
          [{ from: "k/User.kt", to: "k/Expect.kt", names: ["go"] }],
        ),
      ).not.toHaveProperty("k/Expect.jvm.kt");
    });

    it("clears an actual file whose expect file is used whole", () => {
      expect(
        unusedOf(
          [expectFile, actualFile, { id: "k/User.kt", exports: ["u"] }],
          [{ from: "k/User.kt", to: "k/Expect.kt" }],
        ),
      ).not.toHaveProperty("k/Expect.jvm.kt");
    });

    it("reports an actual member whose expect member is only called recursively or not at all", () => {
      expect(
        unusedOf([expectFile, actualFile], [], [], null, [
          { from: "k/Expect.kt::go", to: "k/Expect.kt::go" },
        ]),
      ).toHaveProperty("k/Expect.jvm.kt", ["go"]);
      expect(unusedOf([expectFile, actualFile])).toHaveProperty(
        "k/Expect.jvm.kt",
        ["go"],
      );
    });

    it("keeps the names with no called counterpart in a mixed actual file", () => {
      const mixed = {
        id: "k/Expect.jvm.kt",
        exports: ["go", "helper", "extra"],
        actual_of: ["k/Expect.kt"],
      };

      expect(
        unusedOf([expectFile, mixed], [], [], null, [
          { from: "k/Expect.kt::other", to: "k/Expect.kt::go" },
        ]),
      ).toHaveProperty("k/Expect.jvm.kt", ["extra", "helper"]);
    });

    it("passes use down a chain and terminates on a cycle", () => {
      const middle = {
        id: "k/Expect.mid.kt",
        exports: ["go"],
        actual_of: ["k/Expect.kt"],
      };
      const leaf = {
        id: "k/Expect.leaf.kt",
        exports: ["go"],
        actual_of: ["k/Expect.mid.kt"],
      };
      const calls = [{ from: "k/Expect.kt::helper", to: "k/Expect.kt::go" }];

      expect(
        unusedOf([expectFile, middle, leaf], [], [], null, calls),
      ).not.toHaveProperty("k/Expect.leaf.kt");

      const cyclic = [
        { id: "k/A.kt", exports: ["go"], actual_of: ["k/B.kt"] },
        { id: "k/B.kt", exports: ["go"], actual_of: ["k/A.kt"] },
      ];

      expect(unusedOf(cyclic)).toEqual({
        "k/A.kt": ["go"],
        "k/B.kt": ["go"],
      });
    });

    it("counts nothing from an ignored or absent expect id", () => {
      const calls = [{ from: "k/Expect.kt::helper", to: "k/Expect.kt::go" }];

      expect(
        unusedOf(
          [expectFile, actualFile],
          [],
          [],
          "ignore:\n  - k/Expect.kt\n",
          calls,
        ),
      ).toHaveProperty("k/Expect.jvm.kt", ["go"]);
      expect(
        unusedOf(
          [{ ...actualFile, actual_of: ["k/Missing.kt"] }],
          [],
          [],
          null,
          [{ from: "k/Missing.kt::a", to: "k/Missing.kt::go" }],
        ),
      ).toHaveProperty("k/Expect.jvm.kt", ["go"]);
    });
  });

  describe("expect files", () => {
    const expectFile = { id: "k/Expect.kt", exports: ["go", "helper"] };
    const actualFile = {
      id: "k/Expect.jvm.kt",
      exports: ["go"],
      actual_of: ["k/Expect.kt"],
    };
    const called = [{ from: "k/Expect.kt::helper", to: "k/Expect.kt::go" }];

    it("clears an expect member called from another member of its own file", () => {
      expect(
        unusedOf([expectFile, actualFile], [], [], null, called),
      ).toHaveProperty("k/Expect.kt", ["helper"]);
    });

    it("reports an expect member with no call from another member or only a recursive call", () => {
      expect(unusedOf([expectFile, actualFile])).toHaveProperty("k/Expect.kt", [
        "go",
        "helper",
      ]);
      expect(
        unusedOf([expectFile, actualFile], [], [], null, [
          { from: "k/Expect.kt::go", to: "k/Expect.kt::go" },
        ]),
      ).toHaveProperty("k/Expect.kt", ["go", "helper"]);
    });

    it("keeps a called ordinary member with no same-named actual and drops a file with every name cleared", () => {
      const mixed = {
        id: "k/Expect.kt",
        exports: ["go", "plain"],
      };

      expect(
        unusedOf([mixed, actualFile], [], [], null, [
          { from: "k/Expect.kt::other", to: "k/Expect.kt::go" },
          { from: "k/Expect.kt::other", to: "k/Expect.kt::plain" },
        ]),
      ).toHaveProperty("k/Expect.kt", ["plain"]);

      const shared = { id: "k/Expect.kt", exports: ["go"] };

      expect(
        unusedOf([shared, actualFile], [], [], null, called),
      ).not.toHaveProperty("k/Expect.kt");
    });

    it("counts nothing from an ignored or absent actual module", () => {
      expect(
        unusedOf(
          [expectFile, actualFile],
          [],
          [],
          "ignore:\n  - k/Expect.jvm.kt\n",
          called,
        ),
      ).toHaveProperty("k/Expect.kt", ["go", "helper"]);
      expect(unusedOf([expectFile], [], [], null, called)).toHaveProperty(
        "k/Expect.kt",
        ["go", "helper"],
      );
    });

    it("clears the shared called members of an intermediate module and judges the rest as before", () => {
      const middle = {
        id: "k/Expect.mid.kt",
        exports: ["go", "other"],
        actual_of: ["k/Expect.kt"],
      };
      const leaf = {
        id: "k/Expect.leaf.kt",
        exports: ["go"],
        actual_of: ["k/Expect.mid.kt"],
      };

      expect(
        unusedOf([expectFile, middle, leaf], [], [], null, [
          { from: "k/Expect.kt::helper", to: "k/Expect.kt::go" },
          { from: "k/Expect.mid.kt::other", to: "k/Expect.mid.kt::go" },
        ]),
      ).toEqual({ "k/Expect.kt": ["helper"], "k/Expect.mid.kt": ["other"] });
    });
  });

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
    "src/main/App.kt",
  ])("never reports the skipped module %s", (id) => {
    expect(unusedOf([{ id, exports: ["a"] }], [], ["src/main/**"])).toEqual({});
  });

  it.each(["api/src/index.ts", "shop/src/lib.rs"])(
    "reports the unmarked index-like module %s",
    (id) => {
      expect(unusedOf([{ id, exports: ["a"] }], [], [])).toEqual({
        [id]: ["a"],
      });
    },
  );

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

  it("prints the switch after orphan", () => {
    const base = "cycle on, orphan on";

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
