import { readFileSync } from "node:fs";
import type { Scan } from "recognizer";
import { buildFreshness, scanHashes } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  freshnessReport,
  freshnessScope,
  gapOf,
  markStale,
  modulesWithFunctions,
  sensorFreshness,
} from "./scan-freshness";
import type { SensorStatus } from "./sensor-run";

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
  } as unknown as Scan;
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

  it("marks every module out of date when the document has no inputs", () => {
    expect(sensorFreshness(SCOPE, {}, false)).toEqual({
      kind: "known",
      outOfDate: MODULES,
      missing: [],
    });
  });

  it("marks every module out of date when the tests hash differs", () => {
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

  it("does not count a module an unscoped sensor never listed", () => {
    const measured = { inputs: { "a.py": "ha" }, tests: "t1" };

    expect(sensorFreshness(SCOPE, measured, false)).toEqual({
      kind: "known",
      outOfDate: [],
      missing: [],
    });
  });

  it("counts a module with functions that the scoped sensor never listed as missing", () => {
    const measured = { inputs: { "a.py": "ha" }, tests: "t1" };

    expect(sensorFreshness(SCOPE, measured, true)).toEqual({
      kind: "known",
      outOfDate: [],
      missing: ["b.py", "c.py"],
    });
  });

  it("does not count a missing module that has no function", () => {
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

  it("ignores a module no scan hashes", () => {
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

  it("finds no missing module when a complete Mutation run lists every module with a function", () => {
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

describe("sensorFreshness on committed content", () => {
  it("leaves no module of the committed Mutation sample counted missing when its inputs list every module with a function", () => {
    const scan = JSON.parse(
      readFileSync(
        new URL(
          "../../fixtures/mutation/sample/scan.python.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Scan;
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

describe("markStale", () => {
  const ran = (name: string, measured: SensorStatus["measured"]) =>
    ({ name, status: "ran", measured }) as SensorStatus;

  it("never marks a sensor stale whose every module is current", () => {
    const out = markStale(
      [ran("crap", { inputs: { "a.py": "ha" }, tests: "t1" })],
      FRESH,
    );

    expect(out[0]?.status).toBe("ran");
  });

  it("marks a sensor stale when a module changed or the file has no inputs", () => {
    const out = markStale(
      [ran("crap", { inputs: { "a.py": "x" }, tests: "t1" }), ran("lint", {})],
      FRESH,
    );

    expect(out.map(({ status }) => status)).toEqual(["stale", "stale"]);
  });
});

describe("freshnessReport", () => {
  const row = (display: string, gap: string[], neverRun = false) => ({
    name: display.toLowerCase(),
    display,
    gap,
    neverRun,
  });

  it("is complete when nothing is out of date", () => {
    expect(
      freshnessReport("this canvas", MODULES, [row("A", []), row("B", [])]),
    ).toMatchObject({
      complete: true,
      head: "Complete picture",
      body: "Every result for this canvas is current: 3 modules measured by all 2 sensors.",
      bar: null,
    });
  });

  it("is partial when every module is out of date", () => {
    expect(
      freshnessReport("the repository", MODULES, [row("A", MODULES)]),
    ).toMatchObject({
      complete: false,
      head: "Partial picture: 3 of 3 modules out of date",
      bar: { current: 0, outOfDate: 3 },
    });
  });

  it("names the modules, never-run sensors and a bar", () => {
    const report = freshnessReport("the repository", MODULES, [
      row("A", ["b.py"]),
      row("Mutation", MODULES, true),
    ]);

    expect(report?.head).toBe(
      "Partial picture: Mutation has not run; 1 of 3 modules out of date",
    );
    expect(report?.body).toContain("b.py changed since they were scanned");
    expect(report?.bar).toEqual({ current: 2, outOfDate: 1 });
  });

  it("names five modules and counts the rest", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g"];
    const report = freshnessReport("x", many, [row("A", many)]);

    expect(report?.body.startsWith("a, b, c, d, e and 2 more")).toBe(true);
  });

  it("is absent with nothing ticked", () => {
    expect(freshnessReport("x", MODULES, [])).toBeNull();
  });
});
