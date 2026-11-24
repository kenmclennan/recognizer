import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { bundleTemplates } from "../scripts/build-templates.mjs";
import { PluginTemplatesAdapter } from "../src/adapters/plugins/plugin-templates-adapter.js";
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

  it("holds 9 trees, 3 language files and 34 files for the committed templates", () => {
    const bundle = bundleTemplates(join(REPO, "packages/cli/templates"));
    const keys = Object.keys(bundle);
    const languageFiles = keys.filter((key) => key.endsWith("/language.json"));
    const trees = new Set(
      keys
        .filter((key) => !languageFiles.includes(key))
        .map((key) => key.split("/").slice(0, 2).join("/")),
    );

    expect(trees.size).toBe(9);
    expect(languageFiles).toHaveLength(3);
    expect(keys).toHaveLength(34);
    expect(keys).toContain("rust/scanner/src/sha256.rs");
    expect(keys.filter((key) => key.endsWith("sha256.rs"))).toHaveLength(1);
    expect(keys).toContain("python/describer/{{program}}");
    expect(keys).toContain("rust/sensor/.gitignore");
  });

  it("holds a valid language.json in every language folder", () => {
    const root = join(REPO, "packages/cli/templates");
    const folders = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(folders.length).toBeGreaterThan(0);

    for (const folder of folders) {
      const facts = JSON.parse(
        readFileSync(join(root, folder, "language.json"), "utf8"),
      );

      expect(Number.isInteger(facts.order), folder).toBe(true);
    }
  });

  it("is the bundle the build wrote into the CLI", () => {
    expect(new PluginTemplatesAdapter().bundled()).toEqual(
      bundleTemplates(join(REPO, "packages/cli/templates")),
    );
  });
});
