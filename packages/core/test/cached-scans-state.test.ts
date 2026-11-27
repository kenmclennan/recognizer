import { describe, expect, it } from "vitest";
import {
  type CachedScansSources,
  cachedScansState,
  type Extraction,
  Repository,
} from "../src/index.js";

const SELECTION = {
  extensions: [],
  skipDirectoryNames: [],
  skipDirectoryPrefixes: [],
  skipDirectorySuffixes: [],
  skipDirectoriesContaining: [],
  skipFileGlobs: [],
};

function scanned(language: string, commit = "c1"): Repository {
  const extraction: Extraction = {
    language,
    scanner: { name: "s", version: "1" },
    commit,
    modified: false,
    selection: SELECTION,
    files: [{ path: "a.py", hash: "ha" }],
  };

  return Repository.of({ extractions: [extraction] });
}

function sources(overrides: Partial<CachedScansSources> = {}) {
  const hashed: string[] = [];
  const read: string[] = [];

  const made: CachedScansSources = {
    readCached: (language) => {
      read.push(language);

      return scanned(language);
    },
    commit: () => "c1",
    dirtyPaths: () => [],
    hashOf: (path) => {
      hashed.push(path);

      return "ha";
    },
    ...overrides,
  };

  return { made, hashed, read };
}

describe("cachedScansState", () => {
  it("is current for a cache at the current commit with a clean tree", () => {
    const { made } = sources();

    expect(cachedScansState(made, ["python"])).toMatchObject({
      state: "current",
    });
  });

  it("is missing when a language has no cache", () => {
    const { made } = sources({ readCached: () => null });

    expect(cachedScansState(made, ["python"])).toEqual({ state: "missing" });
  });

  it("is missing when one of two languages has no cache", () => {
    const { made } = sources({
      readCached: (language) =>
        language === "python" ? scanned("python") : null,
    });

    expect(cachedScansState(made, ["python", "kotlin"])).toEqual({
      state: "missing",
    });
  });

  it("is stale when the commit differs", () => {
    const { made } = sources({
      readCached: (language) => scanned(language, "old"),
    });

    expect(cachedScansState(made, ["python"])).toEqual({
      state: "stale",
      reason: "scan",
    });
  });

  it("is stale for a scan when there is no commit", () => {
    const { made } = sources({ commit: () => null });

    expect(cachedScansState(made, ["python"])).toEqual({
      state: "stale",
      reason: "scan",
    });
  });

  it("is stale for a scan when the commit differs", () => {
    const { made } = sources({
      readCached: (language) => scanned(language, "old"),
    });

    expect(cachedScansState(made, ["python"])).toEqual({
      state: "stale",
      reason: "scan",
    });
  });

  it("is stale for a scan when a file's hash differs", () => {
    const { made } = sources({ hashOf: () => "changed" });

    expect(cachedScansState(made, ["python"])).toEqual({
      state: "stale",
      reason: "scan",
    });
  });

  it("is stale for a scan when git could not report the dirty paths", () => {
    const { made } = sources({ dirtyPaths: () => null });

    expect(cachedScansState(made, ["python"])).toEqual({
      state: "stale",
      reason: "scan",
    });
  });

  it("is stale and names the paths when the tree is dirty", () => {
    const { made, hashed, read } = sources({
      dirtyPaths: () => ["a.py", "b.py"],
    });

    expect(cachedScansState(made, ["python"])).toEqual({
      state: "stale",
      reason: "uncommitted",
      paths: ["a.py", "b.py"],
    });
    expect(read).toEqual(["python"]);
    expect(hashed).toEqual([]);
  });
});
