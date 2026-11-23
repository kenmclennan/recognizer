import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileGlob, PolicyRule } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { analyse } from "../src/analyse.js";
import { run } from "../src/cli.js";
import { capture } from "./helpers.js";
import { validatedRepository as validateScan } from "./repository-from.js";

type Edge = [string, string] | [string, string, string];

function scanOf(
  edges: Edge[],
  modules: Array<string | [string, string]> = [],
  seed = 0,
  sealed: string[] = [],
) {
  const rows = modules.map((entry) => {
    const [id, kind] = typeof entry === "string" ? [entry, "module"] : entry;
    const members = sealed.includes(id)
      ? [
          {
            name: "M",
            exported: true,
            kind: "interface",
            line: 1,
            tags: ["sealed"],
          },
        ]
      : [];

    return { id, language: "python", kind, members };
  });

  const rowEdges = edges.map(([from, to, kind], index) => ({
    from,
    to,
    kind: kind ?? "depends",
    line: index + 1,
    ...(kind && kind !== "depends" ? { member: "M", to_member: "M" } : {}),
  }));

  if (seed) {
    rows.reverse();
    rowEdges.reverse();
  }

  return {
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
    modules: rows,
    edges: rowEdges,
    foreign: [],
  };
}

function analysed(
  edges: Edge[],
  modules: Array<string | [string, string]> = [],
  sealed: string[] = [],
) {
  const repository = validateScan(scanOf(edges, modules, 0, sealed));

  return {
    ...analyse(repository),
    warnings: repository.cycleWarnings([]),
  };
}

function row(result: ReturnType<typeof analysed>, id: string) {
  const found = result.metrics.find((metric) => metric.id === id);

  if (!found) {
    throw new Error(`no row for ${id}`);
  }

  return found;
}

describe("metrics", () => {
  it("counts distinct files, not edges", () => {
    const result = analysed([
      ["a", "b", "depends"],
      ["a", "b", "inherits"],
      ["c", "b"],
    ]);

    expect(row(result, "a")).toMatchObject({ fan_in: 0, fan_out: 1 });
    expect(row(result, "b")).toMatchObject({ fan_in: 2, fan_out: 0 });
  });

  it("ignores self-edges", () => {
    const result = analysed([["a", "a"]], ["a"]);

    expect(row(result, "a")).toMatchObject({
      fan_in: 0,
      fan_out: 0,
      instability: null,
    });
  });

  it("a foreign target adds nothing to efferent", () => {
    const result = analysed([
      ["a", "b"],
      ["a", "foreign:x"],
    ]);

    expect(row(result, "a")).toMatchObject({ fan_out: 1, efferent: 1 });
    expect(result.metrics.map((metric) => metric.id)).toEqual(["a", "b"]);
  });

  it("scores foreign-only files null and project importers by project imports", () => {
    const result = analysed([
      ["a", "b"],
      ["a", "foreign:os"],
      ["a", "foreign:re"],
      ["c", "a"],
      ["d", "foreign:os"],
    ]);

    expect(row(result, "a")).toMatchObject({ efferent: 1, instability: 0.5 });
    expect(row(result, "b")).toMatchObject({ efferent: 0, instability: 0 });
    expect(row(result, "c")).toMatchObject({ efferent: 1, instability: 1 });
    expect(row(result, "d")).toMatchObject({ efferent: 0, instability: null });
  });

  it("reports null instability for a file with no edges", () => {
    expect(row(analysed([], ["lonely"]), "lonely").instability).toBeNull();
  });

  it("rounds instability to four decimals", () => {
    const result = analysed([
      ["a", "b"],
      ["b", "c"],
      ["d", "b"],
    ]);

    expect(row(result, "b").instability).toBe(0.3333);
  });

  it("marks an interface file abstract", () => {
    const result = analysed([["a", "i"]], [["i", "interface"], "a"]);

    expect(row(result, "i")).toMatchObject({
      kind: "interface",
      abstractness: 1,
    });
    expect(row(result, "a")).toMatchObject({ kind: "module", abstractness: 0 });
  });

  it("gives an edge endpoint missing from files a file row", () => {
    const result = analysed([["a", "ghost"]], ["a"]);

    expect(row(result, "ghost")).toMatchObject({ kind: "module", fan_in: 1 });
  });

  it("drops ignored files and their edges from rows and warnings", () => {
    const scan = validateScan(
      scanOf(
        [
          ["a", "tests/t"],
          ["tests/t", "a"],
          ["a", "b"],
        ],
        ["a", "b", "tests/t"],
      ),
    );
    const result = analyse(scan, [
      PolicyRule.of({ type: "ignore", glob: "tests/**" }),
    ]);

    expect(result.metrics.map((metric) => metric.id)).toEqual(["a", "b"]);
    expect(
      scan.cycleWarnings([PolicyRule.of({ type: "ignore", glob: "tests/**" })]),
    ).toEqual([]);
  });
});

describe("cycle warning", () => {
  it("reports a two-module cycle once", () => {
    const { warnings } = analysed([
      ["a", "b"],
      ["b", "a"],
    ]);

    expect(warnings).toEqual([
      {
        kind: "cycle",
        principle: "levelization",
        fixPattern: "break-cycle",
        summary: "cycle of 2 files: a, b",
        files: ["a", "b"],
        dependencies: [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      },
    ]);
  });

  it("reports a three-module cycle once", () => {
    const { warnings } = analysed([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
    ]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.files).toEqual(["a", "b", "c"]);
  });

  it("reports two disjoint cycles in order of first file", () => {
    const { warnings } = analysed([
      ["x", "y"],
      ["y", "x"],
      ["a", "b"],
      ["b", "a"],
    ]);

    expect(warnings.map((warning) => warning.summary)).toEqual([
      "cycle of 2 files: a, b",
      "cycle of 2 files: x, y",
    ]);
  });

  it("reports nothing for an acyclic graph", () => {
    expect(
      analysed([
        ["a", "b"],
        ["b", "c"],
        ["a", "c"],
      ]).warnings,
    ).toEqual([]);
  });
});

const hierarchy: Edge[] = [
  ["Created", "Event", "implements"],
  ["Deleted", "Event", "implements"],
  ["Event", "Created"],
  ["Event", "Deleted"],
];

const hierarchyModules = ["Event", "Created", "Deleted", "Audit"];

describe("cycle warning - sealed hierarchies", () => {
  it("cycle warning - a sealed type and its direct subtypes are not a cycle", () => {
    const scan = scanOf(hierarchy, hierarchyModules, 0, ["Event"]);

    expect(scan.edges).toHaveLength(4);
    expect(validateScan(scan).cycleWarnings([])).toEqual([]);
  });

  it("cycle warning - a real dependency of a subtype is reported alone", () => {
    const { warnings } = analysed(
      [...hierarchy, ["Created", "Audit"], ["Audit", "Created"]],
      hierarchyModules,
      ["Event"],
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.summary).toBe("cycle of 2 files: Audit, Created");
    expect(warnings[0]?.files).toEqual(["Audit", "Created"]);
    expect(warnings[0]?.dependencies).toEqual([
      { from: "Audit", to: "Created" },
      { from: "Created", to: "Audit" },
    ]);
  });

  it("cycle warning - a cycle through the base omits the hierarchy edges", () => {
    const { warnings } = analysed(
      [...hierarchy, ["Created", "Audit"], ["Audit", "Event"]],
      hierarchyModules,
      ["Event"],
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.files).toEqual(["Audit", "Created", "Event"]);
    expect(warnings[0]?.dependencies).toEqual([
      { from: "Audit", to: "Event" },
      { from: "Created", to: "Audit" },
    ]);
  });

  it("cycle warning - a hierarchy with no edge out of it reports nothing", () => {
    const { warnings } = analysed(
      [...hierarchy, ["Audit", "Event"]],
      hierarchyModules,
      ["Event"],
    );

    expect(warnings).toEqual([]);
  });

  it("cycle warning - two hierarchies report only the one with a real cycle", () => {
    const { warnings } = analysed(
      [
        ...hierarchy,
        ["Created", "Audit"],
        ["Audit", "Created"],
        ["Left", "Base", "implements"],
        ["Base", "Left"],
      ],
      [...hierarchyModules, "Base", "Left"],
      ["Event", "Base"],
    );

    expect(warnings.map((warning) => warning.summary)).toEqual([
      "cycle of 2 files: Audit, Created",
    ]);
  });

  it("cycle warning - a sealed subinterface joins all three levels", () => {
    const { warnings } = analysed(
      [
        ["Mid", "Top", "implements"],
        ["Leaf", "Mid", "implements"],
        ["Top", "Mid"],
        ["Mid", "Leaf"],
        ["Leaf", "Top"],
      ],
      ["Top", "Mid", "Leaf"],
      ["Top", "Mid"],
    );

    expect(warnings).toEqual([]);
  });

  it("cycle warning - metrics ignore the sealed grouping", () => {
    const plain = analysed(hierarchy, hierarchyModules);
    const sealed = analysed(hierarchy, hierarchyModules, ["Event"]);

    expect(sealed.metrics).toEqual(plain.metrics);
    expect(row(sealed, "Event")).toMatchObject({ fan_in: 2, fan_out: 2 });
  });
});

describe("determinism", () => {
  it("is byte-identical when the scan is shuffled", () => {
    const edges: Edge[] = [
      ["a", "b"],
      ["b", "a"],
      ["c", "a"],
      ["a", "c"],
      ["d", "foreign:z"],
    ];
    const modules = ["a", "b", "c", "d"];
    const forward = validateScan(scanOf(edges, modules));
    const reversed = validateScan(scanOf(edges, modules, 1));
    const both = (repository: typeof forward) =>
      JSON.stringify([analyse(repository), repository.cycleWarnings([])]);

    expect(both(reversed)).toBe(both(forward));
  });
});

function execute(args: string[]) {
  const captured = capture();
  const code = run(args, captured.io);

  return { code, out: captured.out(), err: captured.err() };
}

function writeScan(dir: string, edges: Edge[], modules: string[] = []) {
  const path = join(dir, "scan.json");
  writeFileSync(path, JSON.stringify(scanOf(edges, modules)));

  return path;
}

describe("policy-free mode", () => {
  it("emits exactly warnings, metrics and folder metrics and exits 0", () => {
    const dir = makeTempDir("recognizer-warn-");
    const scan = writeScan(dir, [
      ["a", "b"],
      ["b", "a"],
    ]);
    const { code, out, err } = execute(["check", "--scan", scan]);

    expect(code).toBe(0);
    expect(Object.keys(JSON.parse(out))).toEqual([
      "warnings",
      "metrics",
      "folder_metrics",
    ]);
    expect(err).toBe("warnings: 1\n");
  });

  it.each(["--baseline", "--update-baseline", "--init-baseline"])(
    "refuses %s without a policy and writes nothing",
    (flag) => {
      const dir = makeTempDir("recognizer-warn-");
      const scan = writeScan(dir, [["a", "b"]]);
      const before = readdirSync(dir);
      const extra =
        flag === "--baseline" ? [flag, join(dir, "b.json")] : [flag];
      const { code } = execute(["check", "--scan", scan, ...extra]);

      expect(code).toBe(2);
      expect(readdirSync(dir)).toEqual(before);
    },
  );
});
