import { describe, expect, it } from "vitest";
import {
  dependencyEdges,
  type Scan,
  structureSensor,
  validateScan,
} from "../src/index.js";
import { DEFAULT_STRUCTURE_SETTINGS } from "../src/structure-sensor.js";
import {
  folderCycleFindings,
  orphanFindings,
  unusedExportsFindings,
} from "../src/structure-warnings.js";

type Edge = [string, string, "depends" | "declares"];

function scanOf(
  edges: Edge[],
  modules: string[] = [],
  exported: string[] = [],
) {
  const ids = new Set([
    ...modules,
    ...edges.flatMap(([from, to]) => [from, to]),
  ]);

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
    modules: [...ids].map((id) => ({
      id,
      language: "rust",
      kind: "module",
      members: exported.includes(id)
        ? [{ name: "Thing", kind: "class", line: 1, exported: true }]
        : [],
    })),
    edges: edges.map(([from, to, kind], index) => ({
      from,
      to,
      kind,
      line: index + 1,
    })),
    foreign: [],
  }) as Scan;
}

const SETTINGS = {
  ...DEFAULT_STRUCTURE_SETTINGS,
  hub_threshold: 2,
  warnings: {
    ...DEFAULT_STRUCTURE_SETTINGS.warnings,
    hub: true,
    folder_cycle: true,
    cycle: true,
  },
};

function sensor(scan: Scan) {
  return structureSensor([scan], null, SETTINGS, {
    commit: "c",
    modified: false,
  });
}

describe("declares edges", () => {
  it("do not close a folder cycle when the child uses a parent helper", () => {
    const scan = scanOf([
      ["src/lib.rs", "src/helper.rs", "declares"],
      ["src/lib.rs", "src/sub/mod.rs", "declares"],
      ["src/sub/mod.rs", "src/helper.rs", "depends"],
    ]);

    expect(folderCycleFindings(scan, null, { hub_threshold: 10 })).toEqual([]);
  });

  it("still close a folder cycle when the parent uses the child", () => {
    const scan = scanOf([
      ["src/lib.rs", "src/sub/mod.rs", "depends"],
      ["src/sub/mod.rs", "src/helper.rs", "depends"],
    ]);

    expect(folderCycleFindings(scan, null, { hub_threshold: 10 })).toHaveLength(
      1,
    );
  });

  it("add nothing to fan-in, fan-out or instability and make no hub", () => {
    const scan = scanOf([
      ["src/lib.rs", "src/a.rs", "declares"],
      ["src/lib.rs", "src/b.rs", "declares"],
      ["src/lib.rs", "src/c.rs", "declares"],
    ]);
    const result = sensor(scan);

    for (const metric of result.metrics) {
      expect(metric.fan_in).toBe(0);
      expect(metric.fan_out).toBe(0);
      expect(metric.efferent).toBe(0);
      expect(metric.afferent).toBe(0);
    }

    expect(
      result.document.findings.filter((found) => found.kind === "hub"),
    ).toEqual([]);
  });

  it("keep a module only they reach from being an orphan", () => {
    const scan = scanOf([["src/lib.rs", "src/child.rs", "declares"]]);

    expect(
      orphanFindings(scan, null, ["src/lib.rs"]).map((found) => found.id),
    ).toEqual([]);
  });

  it("leave a module with no edge at all an orphan", () => {
    const scan = scanOf([], ["src/stray.rs"]);

    expect(orphanFindings(scan, null, []).map((found) => found.id)).toEqual([
      "orphan:src/stray.rs",
    ]);
  });

  it("separate a declared module from an unreached one in the same scan", () => {
    const scan = scanOf(
      [["src/lib.rs", "src/child.rs", "declares"]],
      ["src/stray.rs"],
    );

    expect(
      orphanFindings(scan, null, ["src/lib.rs"]).map((found) => found.id),
    ).toEqual(["orphan:src/stray.rs"]);
  });

  it("still count as a whole use of the child for unused_exports", () => {
    const scan = scanOf(
      [["src/lib.rs", "src/child.rs", "declares"]],
      [],
      ["src/child.rs"],
    );

    expect(unusedExportsFindings(scan, null, ["src/lib.rs"])).toEqual([]);
  });

  it("are removed by dependencyEdges and nothing else is", () => {
    const scan = scanOf([
      ["a.rs", "b.rs", "declares"],
      ["a.rs", "c.rs", "depends"],
    ]);

    expect(dependencyEdges(scan.edges).map((edge) => edge.to)).toEqual([
      "c.rs",
    ]);
  });
});
