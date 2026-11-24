import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type LanguageRule,
  readsDirectoriesOf,
  readsPath,
  SKIPPED_DIRECTORIES,
} from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(resolve(here, relative), "utf8"));
}

const RULES = readJson<LanguageRule[]>(
  "../../../../fixtures/plugins/languages.json",
);
const PARITY = readJson<Record<string, { tree: string[]; accepted: string[] }>>(
  "../../../../fixtures/selection-parity.json",
);

function ruleOf(name: string): LanguageRule {
  const rule = RULES.find((one) => one.name === name);

  if (rule === undefined) {
    throw new Error(`no rule for ${name}`);
  }

  return rule;
}

describe("readsPath", () => {
  it.each(["python", "typescript", "kotlin", "rust", "csharp"])(
    "reads exactly the accepted paths of the shared tree, per language (%s)",
    (language) => {
      const { tree, accepted } = PARITY[language];
      const present = new Set(tree);

      expect(accepted.length).toBeGreaterThan(0);
      expect(
        tree.filter((path) =>
          readsPath(ruleOf(language), path, (one) => present.has(one)),
        ),
      ).toEqual(accepted);
    },
  );

  it("a directory holding a marker file is skipped, and is read without it", () => {
    const python = ruleOf("python");
    const listing = ["env/lib.py", "env/pyvenv.cfg"];

    expect(
      readsPath(python, "env/lib.py", (one) => listing.includes(one)),
    ).toBe(false);
    expect(readsPath(python, "env/lib.py", () => false)).toBe(true);
  });

  it("a file named in files is not dropped by a file glob", () => {
    const rule: LanguageRule = {
      name: "x",
      extensions: [],
      files: ["x.d.ts"],
      skip: {
        directory_names: [],
        directory_prefixes: [],
        directory_suffixes: [],
        directory_markers: [],
        file_globs: ["*.d.ts"],
      },
    };

    expect(readsPath(rule, "x.d.ts", () => false)).toBe(true);
  });

  it("the repository root is never skipped by name", () => {
    const python = ruleOf("python");

    expect(readsPath(python, "a.py", () => false)).toBe(true);
    expect(readsPath(python, ".hidden/a.py", () => false)).toBe(false);
    expect(readsPath(python, "tests/a.py", () => false)).toBe(false);
  });
});

function keptBy(language: string, listing: string[]): string[] {
  const listed = new Set(listing);

  return listing.filter((path) =>
    readsDirectoriesOf(ruleOf(language), path, (one) => listed.has(one)),
  );
}

describe("readsDirectoriesOf", () => {
  it("holds only folders no language owns", () => {
    expect([...SKIPPED_DIRECTORIES].sort()).toEqual([
      ".git",
      ".recognizer",
      ".worktrees",
      "build",
      "dist",
    ]);
  });

  it("drops a language's own build folder and keeps it for the others", () => {
    const listing = [
      "Cargo.toml",
      "src/lib.rs",
      "target/Cargo.toml",
      "tests/Cargo.toml",
      "bin/Cargo.toml",
    ];

    expect(keptBy("rust", listing)).toEqual([
      "Cargo.toml",
      "src/lib.rs",
      "bin/Cargo.toml",
    ]);
    expect(keptBy("python", listing)).toEqual([
      "Cargo.toml",
      "src/lib.rs",
      "target/Cargo.toml",
      "bin/Cargo.toml",
    ]);
    expect(keptBy("csharp", listing)).toEqual([
      "Cargo.toml",
      "src/lib.rs",
      "target/Cargo.toml",
      "tests/Cargo.toml",
    ]);
  });

  it("applies a marker only to the rule that declares it", () => {
    const listing = [
      "venv/lib.py",
      "venv/pyvenv.cfg",
      "venv/a.js",
      "env/lib.py",
      "env/pyvenv.cfg",
    ];

    expect(keptBy("python", listing)).toEqual([]);
    expect(keptBy("typescript", listing)).toEqual(listing);
  });

  it("keeps a root file and a markerless venv folder", () => {
    for (const language of [
      "python",
      "typescript",
      "kotlin",
      "rust",
      "csharp",
    ]) {
      expect(keptBy(language, ["Cargo.toml"])).toEqual(["Cargo.toml"]);
    }

    expect(keptBy("python", ["venv/lib.py"])).toEqual(["venv/lib.py"]);
  });
});
