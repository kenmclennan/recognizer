import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyse } from "../src/analyse.js";
import { run } from "../src/cli.js";
import { check, InputError, parsePolicy, validateScan } from "../src/index.js";
import { capture } from "./helpers.js";

const POLICY = `
levels: [inner, outer]
components:
  inner: i/**
  outer: o/**
`;

const INFERRED = {
  parameter: "store",
  methods: ["save"],
  class: "Store",
  implementations: [],
};

function scanOf(edges: object[], version = 5) {
  return {
    schema_version: version,
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
    modules: ["i/a.py", "o/b.py"].map((id) => ({
      id,
      language: "python",
      kind: "module",
      members: [],
    })),
    edges,
    foreign: [],
  };
}

const inferredEdge = (from: string, to: string) => ({
  from,
  to,
  kind: "depends",
  line: 2,
  names: ["save"],
  inferred: INFERRED,
});

const plainEdge = (from: string, to: string) => ({
  from,
  to,
  kind: "depends",
  line: 2,
});

describe("scan versions", () => {
  it("accepts version 5", () => {
    expect(() => validateScan(scanOf([]))).not.toThrow();
  });

  it("exits 2 on a version-1 scan file", () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "recognizer-v1-")),
      "scan.json",
    );
    writeFileSync(path, JSON.stringify(scanOf([], 1)));
    const captured = capture();

    expect(run(["check", "--scan", path], captured.io)).toBe(2);
    expect(captured.err()).toContain("schema_version");
  });

  it("refuses version 1", () => {
    expect(() => validateScan(scanOf([], 1))).toThrow(InputError);
  });
});

describe("inferred edges", () => {
  it("produce no violation", () => {
    const result = check(
      scanOf([inferredEdge("i/a.py", "o/b.py")]),
      parsePolicy(POLICY),
      null,
    );

    expect(result.violations).toEqual([]);
  });

  it("produce a violation once the edge is not inferred", () => {
    const result = check(
      scanOf([plainEdge("i/a.py", "o/b.py")]),
      parsePolicy(POLICY),
      null,
    );

    expect(result.violations).toHaveLength(1);
  });

  it("add no fan-out and no cycle", () => {
    const withInferred = analyse(
      validateScan(
        scanOf([
          inferredEdge("i/a.py", "o/b.py"),
          inferredEdge("o/b.py", "i/a.py"),
        ]),
      ),
      { hub: 1 },
    );
    const without = analyse(validateScan(scanOf([])), { hub: 1 });

    expect(withInferred).toEqual(without);
    expect(withInferred.warnings).toEqual([]);
  });

  it("do not add a module to the node set", () => {
    const scan = scanOf([inferredEdge("i/a.py", "o/elsewhere.py")]);
    const ids = analyse(validateScan(scan), { hub: 10 }).metrics.map(
      (metric) => metric.id,
    );

    expect(ids).not.toContain("o/elsewhere.py");
  });

  it("count as edges when the same scan has them non-inferred", () => {
    const result = analyse(
      validateScan(
        scanOf([plainEdge("i/a.py", "o/b.py"), plainEdge("o/b.py", "i/a.py")]),
      ),
      { hub: 10 },
    );

    expect(result.warnings.map((warning) => warning.id)).toContain("cycle");
  });
});
