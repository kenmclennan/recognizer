import { describe, expect, it } from "vitest";
import {
  Dependency,
  documentFreshness,
  IgnoreRule,
  measuredFiles,
  measuredModules,
  Repository,
} from "../../src/index.js";
import { repositoryOf } from "../fakes/repository-of.js";

const HASHES = { "a.py": "ha", "b.py": "hb", "c.py": "hc" };
const FILES = ["a.py", "b.py", "c.py"];
const ALL = { inputs: { "a.py": "ha", "b.py": "hb", "c.py": "hc" } };
const IGNORE_B = [new IgnoreRule({ glob: "b.py" })];

function edge(from: string, to: string): Dependency {
  return new Dependency({
    from,
    to,
    toLibrary: false,
    language: "python",
    kind: "depends",
    line: 1,
  });
}

describe("measuredFiles", () => {
  const scan = repositoryOf(HASHES, FILES);

  it("returns a non-structure sensor's current list exactly, in order", () => {
    const freshness = documentFreshness(
      scan,
      { inputs: { "c.py": "hc", "a.py": "ha", "b.py": "old" } },
      null,
    );

    expect(freshness.current).toEqual(["a.py", "c.py"]);
    expect(measuredFiles(scan, IGNORE_B, "crap", freshness)).toEqual([
      "a.py",
      "c.py",
    ]);
  });

  it("narrows the structure sensor by the policy", () => {
    const freshness = documentFreshness(scan, ALL, null);
    const covered = measuredModules(scan, IGNORE_B);

    expect(covered.size).toBeGreaterThan(0);
    expect(covered.size).toBeLessThan(freshness.current.length);
    expect(measuredFiles(scan, IGNORE_B, "structure", freshness)).toEqual([
      "a.py",
      "c.py",
    ]);
  });

  it("returns all current files for the structure sensor with no policy", () => {
    const freshness = documentFreshness(scan, ALL, null);

    expect(measuredFiles(scan, null, "structure", freshness)).toEqual(FILES);
  });

  it("returns nothing for a document with no inputs", () => {
    const freshness = documentFreshness(scan, {}, null);

    expect(freshness.valid).toBe(false);
    expect(measuredFiles(scan, null, "structure", freshness)).toEqual([]);
    expect(measuredFiles(scan, null, "crap", freshness)).toEqual([]);
  });

  it("returns only the current file of a mixed document", () => {
    const freshness = documentFreshness(
      scan,
      { inputs: { "a.py": "ha", "b.py": "old", "gone.py": "hg" } },
      null,
    );

    expect(measuredFiles(scan, null, "crap", freshness)).toEqual(["a.py"]);
    expect(measuredFiles(scan, null, "structure", freshness)).toEqual(["a.py"]);
  });

  it("never returns an edge target that is not a scanned file", () => {
    const base = repositoryOf(HASHES, FILES);
    const linked = Repository.of({
      files: base.files,
      dependencies: [edge("a.py", "ghost.py")],
    });
    const freshness = documentFreshness(base, ALL, null);

    expect(measuredModules(linked, null).has("ghost.py")).toBe(true);
    expect(measuredFiles(linked, null, "structure", freshness)).toEqual(FILES);
  });
});
