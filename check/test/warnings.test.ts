import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { analyse } from "../src/analyse.js";
import { run } from "../src/cli.js";
import { compileGlob } from "../src/glob.js";
import { validateScan } from "../src/scan.js";
import { capture } from "./helpers.js";

type Edge = [string, string] | [string, string, string];

function scanOf(
  edges: Edge[],
  modules: Array<string | [string, string]> = [],
  seed = 0,
) {
  const rows = modules.map((entry) => {
    const [id, kind] = typeof entry === "string" ? [entry, "module"] : entry;

    return { id, language: "python", kind, members: [] };
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
) {
  return analyse(validateScan(scanOf(edges, modules)));
}

function row(result: ReturnType<typeof analysed>, id: string) {
  const found = result.metrics.find((metric) => metric.id === id);

  if (!found) {
    throw new Error(`no row for ${id}`);
  }

  return found;
}

describe("metrics", () => {
  it("counts distinct modules, not edges", () => {
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

  it("scores foreign-only modules null and project importers by project imports", () => {
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

  it("reports null instability for a module with no edges", () => {
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

  it("marks an interface module abstract", () => {
    const result = analysed([["a", "i"]], [["i", "interface"], "a"]);

    expect(row(result, "i")).toMatchObject({
      kind: "interface",
      abstractness: 1,
    });
    expect(row(result, "a")).toMatchObject({ kind: "module", abstractness: 0 });
  });

  it("gives an edge endpoint missing from modules a module row", () => {
    const result = analysed([["a", "ghost"]], ["a"]);

    expect(row(result, "ghost")).toMatchObject({ kind: "module", fan_in: 1 });
  });

  it("drops ignored modules and their edges from rows and warnings", () => {
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
    const result = analyse(scan, [compileGlob("tests/**")]);

    expect(result.metrics.map((metric) => metric.id)).toEqual(["a", "b"]);
    expect(result.warnings).toEqual([]);
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
        id: "cycle",
        principle: "levelization",
        fix_pattern: "break-cycle",
        summary: "cycle of 2 modules: a, b",
        evidence: {
          modules: ["a", "b"],
          edges: [
            { from: "a", to: "b" },
            { from: "b", to: "a" },
          ],
        },
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
    expect(warnings[0]?.evidence).toMatchObject({ modules: ["a", "b", "c"] });
  });

  it("reports two disjoint cycles in order of first module", () => {
    const { warnings } = analysed([
      ["x", "y"],
      ["y", "x"],
      ["a", "b"],
      ["b", "a"],
    ]);

    expect(warnings.map((warning) => warning.summary)).toEqual([
      "cycle of 2 modules: a, b",
      "cycle of 2 modules: x, y",
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
    const forward = analyse(validateScan(scanOf(edges, modules)));
    const reversed = analyse(validateScan(scanOf(edges, modules, 1)));

    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
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
