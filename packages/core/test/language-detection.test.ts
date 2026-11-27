import { describe, expect, it } from "vitest";
import {
  detectLanguageNames,
  type LanguageRule,
  type LanguageTree,
} from "../src/index.js";

function rule(
  name: string,
  extension: string,
  skip: Partial<LanguageRule["skip"]> = {},
): LanguageRule {
  return {
    name,
    extensions: [extension],
    files: [],
    skip: {
      directory_names: [],
      directory_prefixes: [],
      directory_suffixes: [],
      directory_markers: [],
      file_globs: [],
      ...skip,
    },
  };
}

function treeOf(
  directories: Record<string, string[]>,
  listing: string[] | null = null,
) {
  const visited: string[] = [];

  const tree: LanguageTree = {
    listing: listing === null ? null : new Set(listing),
    entries: (directory) => {
      visited.push(directory);

      return (directories[directory] ?? []).map((entry) =>
        entry.endsWith("/")
          ? { name: entry.slice(0, -1), kind: "directory" }
          : { name: entry, kind: "file" },
      );
    },
  };

  return { tree, visited };
}

const PYTHON = rule("python", ".py", { directory_names: [".venv"] });
const KOTLIN = rule("kotlin", ".kt");

describe("detectLanguageNames", () => {
  it("finds a language whose file is claimed by a rule", () => {
    const { tree } = treeOf({ "": ["a.py"] });

    expect(detectLanguageNames([PYTHON, KOTLIN], tree)).toEqual(["python"]);
  });

  it("skips the shared skipped directories", () => {
    const { tree } = treeOf({ "": ["dist/"], dist: ["a.py"] });

    expect(detectLanguageNames([PYTHON], tree)).toEqual([]);
  });

  it("skips a directory a rule names", () => {
    const { tree } = treeOf({ "": [".venv/"], ".venv": ["a.py"] });

    expect(detectLanguageNames([PYTHON], tree)).toEqual([]);
  });

  it("drops a rule below a directory marker but not at the root", () => {
    const marked = rule("python", ".py", { directory_markers: ["marker"] });
    const atRoot = treeOf({ "": ["marker", "a.py"] });
    const below = treeOf({
      "": ["sub/"],
      sub: ["marker", "b.py"],
    });

    expect(detectLanguageNames([marked], atRoot.tree)).toEqual(["python"]);
    expect(detectLanguageNames([marked], below.tree)).toEqual([]);
  });

  it("hides a file the git listing omits", () => {
    const { tree } = treeOf({ "": ["a.py"] }, ["other.txt"]);

    expect(detectLanguageNames([PYTHON], tree)).toEqual([]);
  });

  it("walks every file when there is no listing", () => {
    const { tree } = treeOf({ "": ["pkg/"], pkg: ["a.py"] }, null);

    expect(detectLanguageNames([PYTHON], tree)).toEqual(["python"]);
  });

  it("matches the listing by root-relative path", () => {
    const { tree } = treeOf({ "": ["pkg/"], pkg: ["a.py"] }, ["pkg/a.py"]);

    expect(detectLanguageNames([PYTHON], tree)).toEqual(["python"]);
  });

  it("stops walking once every language is found", () => {
    const { tree, visited } = treeOf({
      "": ["first/", "second/"],
      first: ["a.py"],
      second: ["b.py"],
    });

    expect(detectLanguageNames([PYTHON], tree)).toEqual(["python"]);
    expect(visited).toEqual(["", "first"]);
  });

  it("returns the names sorted", () => {
    const { tree } = treeOf({ "": ["a.py", "b.kt"] });

    expect(detectLanguageNames([PYTHON, KOTLIN], tree)).toEqual([
      "kotlin",
      "python",
    ]);
  });
});
