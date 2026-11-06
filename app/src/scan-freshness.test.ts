import { readFileSync } from "node:fs";
import type { Scan } from "recognizer";
import { buildFreshness, scanHashes } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  coverageNote,
  freshnessMessage,
  freshnessReport,
  freshnessScope,
  gapOf,
  markStale,
  modulesWithFunctions,
  planFor,
  type RowGap,
  sensorFreshness,
} from "./scan-freshness";
import type { ScanTicks } from "./scan-panel-model";
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

describe("planFor", () => {
  const rows = [
    { name: "crap", display: "C.R.A.P.", runsTests: false },
    { name: "mutation", display: "Mutation", runsTests: true },
  ];
  const ticks: ScanTicks = {
    describe: true,
    ticked: ["crap"],
    once: ["mutation"],
    onlyView: false,
  };
  const clean: RowGap = { gap: [], neverRun: false };
  const gaps = (entries: Record<string, RowGap>) =>
    new Map(Object.entries(entries));

  it("leaves a current sensor out and hands Mutation and Descriptions the union of their gaps", () => {
    const planned = planFor(
      "bring",
      ticks,
      rows,
      gaps({
        describe: { gap: ["a.py"], neverRun: false },
        crap: clean,
        mutation: { gap: ["b.py", "c.py"], neverRun: false },
      }),
      null,
      MODULES,
    );

    expect(planned.plan).toEqual({
      describe: true,
      describeAll: false,
      sense: ["mutation"],
      modules: ["a.py", "b.py", "c.py"],
    });
    expect(planned.label).toBe("Bring 3 modules up to date");
    expect(planned.progress).toBe("Bringing 3 modules up to date\u2026");
    expect(planned.idle).toBe(false);
  });

  it("reruns an unscoped sensor whole and sends no module list when no scoped phase runs", () => {
    const planned = planFor(
      "bring",
      { ...ticks, describe: false, once: [] },
      rows,
      gaps({ crap: { gap: ["b.py"], neverRun: false } }),
      null,
      MODULES,
    );

    expect(planned.plan).toEqual({
      describe: false,
      describeAll: false,
      sense: ["crap"],
      modules: null,
    });
    expect(planned.label).toBe("Bring 1 module up to date");
  });

  it("is idle and reads Up to date when nothing has a gap", () => {
    const planned = planFor(
      "bring",
      ticks,
      rows,
      gaps({ describe: clean, crap: clean, mutation: clean }),
      null,
      MODULES,
    );

    expect(planned.idle).toBe(true);
    expect(planned.label).toBe("Up to date");
    expect(planned.plan.sense).toEqual([]);
    expect(planned.plan.describe).toBe(false);
    expect(planned.plan.modules).toBeNull();
  });

  it("names a never-run sensor on the button when it is the only work", () => {
    const planned = planFor(
      "bring",
      { ...ticks, describe: false, ticked: [] },
      rows,
      gaps({ mutation: { gap: MODULES, neverRun: true } }),
      null,
      MODULES,
    );

    expect(planned.label).toBe("Run Mutation");
    expect(planned.plan.sense).toEqual(["mutation"]);
    expect(planned.plan.modules).toEqual(MODULES);
  });

  it("runs every ticked sensor over the scope and describes everything when rescanning", () => {
    const planned = planFor(
      "rescan",
      ticks,
      rows,
      gaps({ describe: clean, crap: clean, mutation: clean }),
      ["a.py", "b.py"],
      MODULES,
    );

    expect(planned.plan).toEqual({
      describe: true,
      describeAll: true,
      sense: ["crap", "mutation"],
      modules: ["a.py", "b.py"],
    });
    expect(planned.label).toBe("Rescan 2 modules");
    expect(planned.progress).toBe("Rescanning 2 modules\u2026");

    expect(
      planFor("rescan", ticks, rows, gaps({}), null, MODULES).plan.modules,
    ).toBeNull();
  });

  it("keeps the run enabled when nothing is ticked so a plain rescan stays reachable", () => {
    const planned = planFor(
      "rescan",
      { describe: false, ticked: [], once: [], onlyView: false },
      rows,
      gaps({}),
      null,
      MODULES,
    );

    expect(planned.idle).toBe(false);
  });
});

describe("freshnessMessage and coverageNote", () => {
  const row = (display: string, gap: string[], neverRun = false) => ({
    name: display.toLowerCase(),
    display,
    gap,
    neverRun,
  });

  it("says nothing for a complete picture or no report", () => {
    expect(freshnessMessage(null)).toBeNull();
    expect(
      freshnessMessage(freshnessReport("x", MODULES, [row("A", [])])),
    ).toBeNull();
  });

  it("counts the out-of-date modules and keys the message by their set", () => {
    const one = freshnessMessage(
      freshnessReport("x", MODULES, [row("A", ["b.py"])]),
    );
    const two = freshnessMessage(
      freshnessReport("x", MODULES, [row("A", ["b.py", MODULES[0]])]),
    );

    expect(one?.text).toBe(
      "1 module has changed since it was scanned. Its results are hidden, so this picture is partial.",
    );
    expect(two?.text.startsWith("2 modules have changed")).toBe(true);
    expect(one?.neverRunOnly).toBe(false);
    expect(one?.key).not.toBe(two?.key);
  });

  it("reports Mutation never run when nothing is out of date", () => {
    expect(
      freshnessMessage(
        freshnessReport("x", MODULES, [row("Mutation", MODULES, true)]),
      )?.text,
    ).toBe(
      "Mutation has not run here yet. Survived-mutant results are missing from this picture.",
    );
    expect(
      freshnessMessage(
        freshnessReport("x", MODULES, [row("Mutation", MODULES, true)]),
      )?.neverRunOnly,
    ).toBe(true);
  });

  it("states how many modules the findings cover", () => {
    const report = freshnessReport("x", MODULES, [row("A", ["b.py"])]);

    expect(coverageNote(report, 3)).toBe("from 2 of 3 modules");
    expect(
      coverageNote(freshnessReport("x", MODULES, [row("A", [])]), 3),
    ).toBeNull();
  });
});
