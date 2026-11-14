import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { bundleTemplates } from "../scripts/build-templates.mjs";
import { bundledTemplates } from "../src/plugin-templates.js";
import { REPO } from "./helpers.js";

describe("build-templates", () => {
  it("bundles a temp tree in sorted key order", () => {
    const root = makeTempDir("templates-");

    for (const [path, text] of [
      ["b/second.txt", "two"],
      ["a/first.txt", "one"],
    ] as const) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }

    expect(Object.entries(bundleTemplates(root))).toEqual([
      ["a/first.txt", "one"],
      ["b/second.txt", "two"],
    ]);
  });

  it("holds 9 trees and 31 files for the committed templates", () => {
    const bundle = bundleTemplates(join(REPO, "check/templates"));
    const keys = Object.keys(bundle);
    const trees = new Set(
      keys.map((key) => key.split("/").slice(0, 2).join("/")),
    );

    expect(trees.size).toBe(9);
    expect(keys).toHaveLength(31);
    expect(keys).toContain("rust/scanner/src/sha256.rs");
    expect(keys.filter((key) => key.endsWith("sha256.rs"))).toHaveLength(1);
    expect(keys).toContain("python/describer/{{program}}");
    expect(keys).toContain("rust/sensor/.gitignore");
  });

  it("is the bundle the build wrote into the CLI", () => {
    expect(bundledTemplates()).toEqual(
      bundleTemplates(join(REPO, "check/templates")),
    );
  });
});
