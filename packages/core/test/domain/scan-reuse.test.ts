import { describe, expect, it } from "vitest";
import { type Extraction, extractionsReusable } from "../../src/index.js";

const SELECTION = {
  extensions: [],
  skipDirectoryNames: [],
  skipDirectoryPrefixes: [],
  skipDirectorySuffixes: [],
  skipDirectoriesContaining: [],
  skipFileGlobs: [],
};

function extraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    language: "python",
    scanner: { name: "s", version: "1" },
    commit: "c1",
    modified: false,
    selection: SELECTION,
    files: [
      { path: "a.py", hash: "ha" },
      { path: "b.py", hash: "hb" },
    ],
    ...overrides,
  };
}

const hashes: Record<string, string> = { "a.py": "ha", "b.py": "hb" };
const hashOf = (path: string) => hashes[path] ?? null;

describe("extractionsReusable", () => {
  it("is reusable when commit, modified flag and every hash agree", () => {
    expect(extractionsReusable([extraction()], "c1", hashOf)).toBe(true);
  });

  it("is not reusable when the commit differs", () => {
    expect(extractionsReusable([extraction()], "c2", hashOf)).toBe(false);
  });

  it("is not reusable when the scan was of a modified tree", () => {
    expect(
      extractionsReusable([extraction({ modified: true })], "c1", hashOf),
    ).toBe(false);
  });

  it("is not reusable when the modified flag is absent", () => {
    expect(
      extractionsReusable([extraction({ modified: null })], "c1", hashOf),
    ).toBe(false);
  });

  it("is not reusable when one hash among several differs", () => {
    expect(
      extractionsReusable([extraction()], "c1", (path) =>
        path === "b.py" ? "other" : hashOf(path),
      ),
    ).toBe(false);
  });

  it("is reusable for an empty extraction list", () => {
    expect(extractionsReusable([], "c1", hashOf)).toBe(true);
  });
});
