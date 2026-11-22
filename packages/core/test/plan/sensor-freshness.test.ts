import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildFreshness,
  freshnessScope,
  gapOf,
  modulesWithFunctions,
  type ScanFacts,
  scanHashes,
  sensorFreshness,
} from "../../src/index.js";

function scanOf(files: Record<string, string>, withFunction: string[]) {
  return {
    modules: Object.keys(files).map((id) => ({
      id,
      kind: "module",
      members: withFunction.includes(id)
        ? [{ name: "f", exported: true, kind: "function" }]
        : [],
    })),
    edges: [],
    foreign: [],
    files: Object.entries(files).map(([path, hash]) => ({ path, hash })),
  } as unknown as ScanFacts;
}

const SCAN = scanOf({ "a.py": "ha", "b.py": "hb", "c.py": "hc" }, [
  "a.py",
  "b.py",
  "c.py",
]);
const MODULES = ["a.py", "b.py", "c.py"];
const FRESH = buildFreshness([SCAN], "t1");
const SCOPE = freshnessScope(MODULES, [SCAN], FRESH);

describe("sensorFreshness", () => {
  it("is never-run without a findings document", () => {
    expect(sensorFreshness(SCOPE, null, false)).toEqual({ kind: "never-run" });
    expect(gapOf({ kind: "never-run" }, MODULES)).toEqual(MODULES);
  });

  it("marks every file out of date when the document has no inputs", () => {
    expect(sensorFreshness(SCOPE, {}, false)).toEqual({
      kind: "known",
      outOfDate: MODULES,
      missing: [],
    });
  });

  it("marks every file out of date when the tests hash differs", () => {
    const measured = { inputs: { "a.py": "ha" }, tests: "other" };

    expect(sensorFreshness(SCOPE, measured, false)).toMatchObject({
      outOfDate: MODULES,
    });
  });

  it("counts a changed hash as out of date", () => {
    const measured = { inputs: { "a.py": "ha", "b.py": "old" }, tests: "t1" };

    expect(sensorFreshness(SCOPE, measured, false)).toEqual({
      kind: "known",
      outOfDate: ["b.py"],
      missing: [],
    });
  });

  it("does not count a file an unscoped sensor never listed", () => {
    const measured = { inputs: { "a.py": "ha" }, tests: "t1" };

    expect(sensorFreshness(SCOPE, measured, false)).toEqual({
      kind: "known",
      outOfDate: [],
      missing: [],
    });
  });

  it("counts a file with functions that the scoped sensor never listed as missing", () => {
    const measured = { inputs: { "a.py": "ha" }, tests: "t1" };

    expect(sensorFreshness(SCOPE, measured, true)).toEqual({
      kind: "known",
      outOfDate: [],
      missing: ["b.py", "c.py"],
    });
  });

  it("does not count a missing file that has no function", () => {
    const scan = scanOf({ "a.py": "ha", "b.py": "hb" }, ["a.py"]);
    const scope = freshnessScope(
      ["a.py", "b.py"],
      [scan],
      buildFreshness([scan], "t1"),
    );
    const measured = { inputs: { "a.py": "ha" }, tests: "t1" };

    expect(sensorFreshness(scope, measured, true)).toMatchObject({
      missing: [],
    });
  });

  it("splits the mixed case into out of date and missing", () => {
    const measured = {
      inputs: { "a.py": "ha", "b.py": "changed" },
      tests: "t1",
    };
    const result = sensorFreshness(SCOPE, measured, true);

    expect(result).toEqual({
      kind: "known",
      outOfDate: ["b.py"],
      missing: ["c.py"],
    });
    expect(gapOf(result, MODULES)).toEqual(["b.py", "c.py"]);
  });

  it("ignores a file no scan hashes", () => {
    const scope = freshnessScope([...MODULES, "ghost.py"], [SCAN], FRESH);
    const measured = {
      inputs: { "a.py": "ha", "b.py": "hb", "c.py": "hc", "ghost.py": "x" },
      tests: "t1",
    };

    expect(sensorFreshness(scope, measured, true)).toMatchObject({
      outOfDate: [],
      missing: [],
    });
  });

  it("finds no missing file when a complete Mutation run lists every file with a function", () => {
    const measured = {
      inputs: { "a.py": "ha", "b.py": "hb", "c.py": "hc" },
      tests: "t1",
    };

    expect(sensorFreshness(SCOPE, measured, true)).toMatchObject({
      outOfDate: [],
      missing: [],
    });
  });
});

describe("sensorFreshness with an excluded file in inputs", () => {
  const one = freshnessScope(
    ["a.py"],
    [scanOf({ "a.py": "ha" }, ["a.py"])],
    FRESH,
  );

  it("is neither missing nor out of date while its hash is current", () => {
    const measured = { inputs: { "a.py": "ha" }, tests: "t1" };
    const result = sensorFreshness(one, measured, true);

    expect(result).toEqual({ kind: "known", outOfDate: [], missing: [] });
    expect(gapOf(result, ["a.py"])).toEqual([]);
  });

  it("is out of date once its hash changed", () => {
    const measured = { inputs: { "a.py": "old" }, tests: "t1" };

    expect(sensorFreshness(one, measured, true)).toEqual({
      kind: "known",
      outOfDate: ["a.py"],
      missing: [],
    });
  });

  it("is missing when the document predates the change and lists no inputs", () => {
    const measured = { inputs: {}, tests: "t1" };

    expect(sensorFreshness(one, measured, true)).toEqual({
      kind: "known",
      outOfDate: [],
      missing: ["a.py"],
    });
  });
});

const srcUrl = new URL("../../src/index.ts", import.meta.url).href;

describe("sensorFreshness on committed content", () => {
  it("leaves no file of the committed Mutation sample counted missing when its inputs list every file with a function", () => {
    const scan = JSON.parse(
      readFileSync(
        new URL("../../../fixtures/mutation/sample/scan.python.json", srcUrl),
        "utf8",
      ),
    ) as ScanFacts;
    const withFunctions = [...modulesWithFunctions([scan])];
    const hashes = scanHashes([scan]);
    const inputs = Object.fromEntries(
      withFunctions.map((id) => [id, hashes.get(id) as string]),
    );
    const modules = scan.modules.map(({ id }) => id);
    const scope = freshnessScope(modules, [scan], buildFreshness([scan], "t"));

    expect(sensorFreshness(scope, { inputs, tests: "t" }, true)).toEqual({
      kind: "known",
      outOfDate: [],
      missing: [],
    });
  });
});
