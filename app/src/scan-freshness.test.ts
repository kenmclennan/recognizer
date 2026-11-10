import { readFileSync } from "node:fs";
import type { Scan } from "recognizer";
import { buildFreshness, scanHashes } from "recognizer";
import { describe, expect, it } from "vitest";
import type { FreshnessModel, ResultState } from "./freshness-model";
import {
  freshnessMessage,
  freshnessScope,
  gapOf,
  markStale,
  modulesWithFunctions,
  planFor,
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

function stub(
  states: Record<string, ResultState>,
  gaps: Record<string, string[]>,
  changed: string[],
  label: string,
  ticked: string[] = Object.keys(states),
): FreshnessModel {
  return {
    rows: Object.entries(states).map(([key, state]) => ({
      key,
      name: key === "mutation" ? "Mutation" : key,
      state,
      tickable: true,
    })),
    gaps: new Map(Object.entries(gaps)),
    changed,
    ticked: (key: string) => ticked.includes(key),
    action: {
      primary: { label, disabled: label === "Up to date" },
      mode: { value: "bring", disabled: false },
    },
  } as unknown as FreshnessModel;
}

const CURRENT_STATE: ResultState = { kind: "current", at: null };

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

  it("leaves a current sensor out and hands Mutation and Descriptions the union of their gaps", () => {
    const planned = planFor(
      stub(
        {
          describe: { kind: "out-of-date", modules: ["a.py"] },
          crap: CURRENT_STATE,
          mutation: { kind: "out-of-date", modules: ["b.py", "c.py"] },
        },
        { describe: ["a.py"], crap: [], mutation: ["b.py", "c.py"] },
        ["a.py", "b.py", "c.py"],
        "Update 3 modules",
      ),
      "bring",
      ticks,
      rows,
      null,
      MODULES,
    );

    expect(planned.plan).toEqual({
      describe: true,
      describeAll: false,
      sense: ["mutation"],
      modules: ["a.py", "b.py", "c.py"],
    });
    expect(planned.label).toBe("Update 3 modules");
    expect(planned.progress).toBe("Updating 3 modules\u2026");
    expect(planned.modules).toBe(3);
    expect(planned.idle).toBe(false);
  });

  it("reruns an unscoped sensor whole and sends no module list when no scoped phase runs", () => {
    const planned = planFor(
      stub(
        { crap: { kind: "out-of-date", modules: ["b.py"] } },
        { crap: ["b.py"] },
        ["b.py"],
        "Update 1 module",
      ),
      "bring",
      { ...ticks, describe: false, once: [] },
      rows,
      null,
      MODULES,
    );

    expect(planned.plan).toEqual({
      describe: false,
      describeAll: false,
      sense: ["crap"],
      modules: null,
    });
    expect(planned.progress).toBe("Updating 1 module\u2026");
  });

  it("gives a Structure-only change a runnable extract-only plan", () => {
    const planned = planFor(
      stub(
        {
          structure: { kind: "out-of-date", modules: ["a.py"] },
          crap: CURRENT_STATE,
        },
        { crap: [] },
        ["a.py"],
        "Update 1 module",
      ),
      "bring",
      { ...ticks, describe: false, once: [] },
      rows,
      null,
      MODULES,
    );

    expect(planned.plan).toEqual({
      describe: false,
      describeAll: false,
      sense: [],
      modules: null,
    });
    expect(planned.idle).toBe(false);
    expect(planned.modules).toBe(1);
  });

  it("is idle and reads Up to date when nothing has a gap", () => {
    const planned = planFor(
      stub(
        {
          describe: CURRENT_STATE,
          crap: CURRENT_STATE,
          mutation: CURRENT_STATE,
        },
        { describe: [], crap: [], mutation: [] },
        [],
        "Up to date",
      ),
      "bring",
      ticks,
      rows,
      null,
      MODULES,
    );

    expect(planned.idle).toBe(true);
    expect(planned.label).toBe("Up to date");
    expect(planned.plan.sense).toEqual([]);
    expect(planned.plan.describe).toBe(false);
    expect(planned.plan.modules).toBeNull();
  });

  it("never says Bringing 0 modules when only a never-run sensor runs", () => {
    const planned = planFor(
      stub(
        { mutation: { kind: "never-run" } },
        { mutation: MODULES },
        [],
        "Run Mutation",
      ),
      "bring",
      { ...ticks, describe: false, ticked: [] },
      rows,
      null,
      MODULES,
    );

    expect(planned.label).toBe("Run Mutation");
    expect(planned.progress).toBe("Running Mutation\u2026");
    expect(planned.progress).not.toContain("Bringing");
    expect(planned.plan.sense).toEqual(["mutation"]);
    expect(planned.plan.modules).toEqual(MODULES);
  });

  it("runs every ticked sensor over the scope and describes everything when rescanning", () => {
    const model = stub({}, {}, [], "Rescan 2 modules");
    const planned = planFor(
      model,
      "rescan",
      ticks,
      rows,
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
      planFor(model, "rescan", ticks, rows, null, MODULES).plan.modules,
    ).toBeNull();
  });

  it("keeps the run enabled when nothing is ticked so a plain rescan stays reachable", () => {
    const planned = planFor(
      stub({}, {}, [], "Rescan 3 modules"),
      "rescan",
      { describe: false, ticked: [], once: [], onlyView: false },
      rows,
      null,
      MODULES,
    );

    expect(planned.idle).toBe(false);
  });
});

describe("freshnessMessage", () => {
  it("says nothing when nothing changed and nothing ticked never ran", () => {
    expect(
      freshnessMessage(stub({ crap: CURRENT_STATE }, {}, [], "Up to date")),
    ).toBeNull();
  });

  it("counts the changed modules, keys the message by their set and labels the button", () => {
    const one = freshnessMessage(stub({}, {}, ["b.py"], "Update 1 module"));
    const two = freshnessMessage(
      stub({}, {}, ["a.py", "b.py"], "Update 2 modules"),
    );

    expect(one?.text).toBe(
      "1 module has changed since it was scanned. Its results are hidden, so this picture is partial.",
    );
    expect(one?.label).toBe("Update 1 module");
    expect(two?.text.startsWith("2 modules have changed")).toBe(true);
    expect(one?.key).not.toBe(two?.key);
  });

  it("reports a ticked never-run sensor when nothing changed, and ignores an unticked one", () => {
    const states: Record<string, ResultState> = {
      mutation: { kind: "never-run" },
    };

    expect(
      freshnessMessage(stub(states, {}, [], "Run Mutation")),
    )?.toMatchObject({
      text: "Mutation has not run here yet. Survived-mutant results are missing from this picture.",
      label: "Run Mutation",
    });
    expect(freshnessMessage(stub(states, {}, [], "Up to date", []))).toBeNull();
  });
});
