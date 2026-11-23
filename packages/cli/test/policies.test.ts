import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check, parsePolicy } from "../src/index.js";
import { REPO } from "./helpers.js";

function template(name: string) {
  return parsePolicy(
    readFileSync(join(REPO, "docs", "policies", name), "utf8"),
  );
}

function scanOf(edges: Array<[string, string]>, modules: string[] = []) {
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
    modules: modules.map((id) => ({
      id,
      language: "python",
      kind: "module",
      members: [],
    })),
    edges: edges.map(([from, to], index) => ({
      from,
      to,
      kind: "depends",
      line: index + 1,
    })),
    foreign: [],
  };
}

function outcome(
  name: string,
  edges: Array<[string, string]>,
  modules: string[] = [],
) {
  const result = check(scanOf(edges, modules), template(name), null);

  return {
    rules: result.violations.flatMap((v) =>
      v.dependencies.map((one) => [v.file, one.to, v.rule.type]),
    ),
  };
}

describe("hexagonal.yaml", () => {
  it("flags inner to outer, permits outer to inner, forbids adapter to adapter", () => {
    expect(
      outcome("hexagonal.yaml", [
        ["lightcycle/domain/a.py", "lightcycle/adapters/b.py"],
        ["lightcycle/adapters/b.py", "lightcycle/domain/a.py"],
        ["lightcycle/adapters/x.py", "lightcycle/adapters/y.py"],
      ]).rules,
    ).toEqual([
      ["lightcycle/adapters/x.py", "lightcycle/adapters/y.py", "forbid"],
      ["lightcycle/domain/a.py", "lightcycle/adapters/b.py", "forbid"],
    ]);
  });

  it("finds no violation in the design example", () => {
    const scan = JSON.parse(
      readFileSync(
        join(REPO, "schema/examples/valid/design-example.json"),
        "utf8",
      ),
    );
    const result = check(scan, template("hexagonal.yaml"), null);

    expect(result.violations).toEqual([]);
  });
});

describe("vertical-slices.yaml", () => {
  it("permits slice to shared and flags slice to slice and shared to slice", () => {
    expect(
      outcome("vertical-slices.yaml", [
        ["src/orders/a.py", "src/shared/s.py"],
        ["src/orders/a.py", "src/billing/b.py"],
        ["src/shared/s.py", "src/orders/a.py"],
      ]).rules,
    ).toEqual([
      ["src/orders/a.py", "src/billing/b.py", "forbid"],
      ["src/shared/s.py", "src/orders/a.py", "forbid"],
    ]);
  });

  it("leaves a module under src/other unconstrained", () => {
    expect(
      outcome(
        "vertical-slices.yaml",
        [["src/other/o.py", "src/orders/a.py"]],
        ["src/other/o.py", "src/orders/a.py"],
      ).rules,
    ).toEqual([]);
  });
});
