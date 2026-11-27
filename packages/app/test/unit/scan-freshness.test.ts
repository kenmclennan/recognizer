import { describe, expect, it } from "vitest";
import type { FreshnessModel, ResultState } from "../../src/freshness-text";
import { freshnessMessage } from "../../src/scan-freshness";
import type { ScanTicks } from "../../src/scan-panel-model";
import type { SensorStatus } from "../../src/sensor-run";
import { plannedRun } from "../fixtures";
import { factsFor } from "../freshness-support";
import { type DocScan, repositoryFrom } from "./repository-from";

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
  } as unknown as DocScan;
}

const SCAN = scanOf({ "a.py": "ha", "b.py": "hb", "c.py": "hc" }, [
  "a.py",
  "b.py",
  "c.py",
]);
const MODULES = ["a.py", "b.py", "c.py"];
const factsOf = (statuses: SensorStatus[]) =>
  factsFor(repositoryFrom([SCAN]), statuses, "t1");
const markStale = (statuses: SensorStatus[]) => {
  const facts = factsOf(statuses);

  return statuses.map((one) => {
    const entry = facts[one.name];

    return entry?.stale ? { ...one, status: "stale" as const } : one;
  });
};

describe("markStale", () => {
  const ran = (name: string, measured: SensorStatus["measured"]) =>
    ({ name, status: "ran", measured }) as SensorStatus;

  it("never marks a sensor stale whose every file is current", () => {
    const out = markStale([
      ran("crap", { inputs: { "a.py": "ha" }, tests: "t1" }),
    ]);

    expect(out[0]?.status).toBe("ran");
  });

  it("marks a sensor stale when a file changed or the file has no inputs", () => {
    const out = markStale([
      ran("crap", { inputs: { "a.py": "x" }, tests: "t1" }),
      ran("lint", {}),
    ]);

    expect(out.map(({ status }) => status)).toEqual(["stale", "stale"]);
  });
});

function stub(
  states: Record<string, ResultState>,
  gaps: Record<string, string[]>,
  changed: string[],
  label: string,
  ticked: string[] = Object.keys(states),
  update: string[] = changed,
  scopedKeys: string[] = ["mutation"],
): FreshnessModel {
  return {
    rows: Object.entries(states).map(([key, state]) => ({
      key,
      name: key[0]?.toUpperCase() + key.slice(1),
      state,
      tickable: true,
      scoped: scopedKeys.includes(key),
    })),
    gaps: new Map(Object.entries(gaps)),
    changed,
    update,
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
    { name: "crap", display: "C.R.A.P.", runsTests: false, scoped: false },
    { name: "mutation", display: "Mutation", runsTests: true, scoped: true },
  ];
  const ticks: ScanTicks = {
    describe: true,
    analysis: true,
    ticked: ["crap"],
    armed: ["mutation"],
    onlyView: false,
    suites: {},
    folds: [],
  };

  it("leaves a current sensor out and hands Mutation and Descriptions the union of their gaps", () => {
    const planned = plannedRun(
      stub(
        {
          describe: { kind: "out-of-date", modules: ["a.py"] },
          crap: CURRENT_STATE,
          mutation: { kind: "out-of-date", modules: ["b.py", "c.py"] },
        },
        { describe: ["a.py"], crap: [], mutation: ["b.py", "c.py"] },
        ["a.py", "b.py", "c.py"],
        "Update 3 files",
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
      analysis: true,
      sense: ["crap", "mutation"],
      modules: ["a.py", "b.py", "c.py"],
    });
    expect(planned.label).toBe("Update 3 files");
    expect(planned.progress).toBe("Updating 3 files\u2026");
    expect(planned.modules).toBe(3);
    expect(planned.idle).toBe(false);
  });

  it("takes the file scope from the scoped flag, not from a sensor called mutation", () => {
    const flagged = [
      { name: "mutation", display: "Mutation", runsTests: true, scoped: false },
      { name: "other", display: "Other", runsTests: true, scoped: true },
    ];
    const both: ScanTicks = {
      ...ticks,
      describe: false,
      analysis: true,
      ticked: [],
      armed: ["mutation", "other"],
    };
    const planned = plannedRun(
      stub(
        {
          mutation: { kind: "out-of-date", modules: ["b.py", "c.py"] },
          other: { kind: "out-of-date", modules: ["b.py"] },
        },
        { mutation: ["b.py", "c.py"], other: ["b.py"] },
        ["b.py", "c.py"],
        "Update 2 files",
        ["mutation", "other"],
        undefined,
        ["other"],
      ),
      "bring",
      both,
      flagged,
      null,
      MODULES,
    );

    expect(planned.plan.modules).toEqual(["b.py", "c.py"]);
    expect(planned.work).toEqual({ mutation: MODULES.length, other: 2 });
  });

  it("reruns an unscoped sensor whole and sends no file list when no scoped phase runs", () => {
    const planned = plannedRun(
      stub(
        { crap: { kind: "out-of-date", modules: ["b.py"] } },
        { crap: ["b.py"] },
        ["b.py"],
        "Update 1 file",
      ),
      "bring",
      { ...ticks, describe: false, armed: [] },
      rows,
      null,
      MODULES,
    );

    expect(planned.plan).toEqual({
      describe: false,
      describeAll: false,
      analysis: true,
      sense: ["crap"],
      modules: null,
    });
    expect(planned.progress).toBe("Updating 1 file\u2026");
  });

  it("gives a Structure-only change a runnable extract-only plan", () => {
    const planned = plannedRun(
      stub(
        {
          structure: { kind: "out-of-date", modules: ["a.py"] },
          crap: CURRENT_STATE,
        },
        { crap: [] },
        ["a.py"],
        "Update 1 file",
      ),
      "bring",
      { ...ticks, describe: false, armed: [] },
      rows,
      null,
      MODULES,
    );

    expect(planned.plan).toEqual({
      describe: false,
      describeAll: false,
      analysis: true,
      sense: ["crap"],
      modules: null,
    });
    expect(planned.idle).toBe(false);
    expect(planned.modules).toBe(1);
  });

  it("is idle and reads Up to date when nothing has a gap", () => {
    const planned = plannedRun(
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

  it("never says Bringing 0 files when only a never-run sensor runs", () => {
    const planned = plannedRun(
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
    const model = stub({}, {}, [], "Rescan 2 files");
    const planned = plannedRun(
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
      analysis: true,
      sense: ["crap", "mutation"],
      modules: ["a.py", "b.py"],
    });
    expect(planned.label).toBe("Rescan 2 files");
    expect(planned.progress).toBe("Rescanning 2 files\u2026");
    expect(
      plannedRun(model, "rescan", ticks, rows, null, MODULES).plan.modules,
    ).toBeNull();
  });

  it("keeps the run enabled when nothing is ticked so a plain rescan stays reachable", () => {
    const planned = plannedRun(
      stub({}, {}, [], "Rescan 3 files"),
      "rescan",
      {
        describe: false,
        analysis: true,
        ticked: [],
        armed: [],
        onlyView: false,
        suites: {},
        folds: [],
      },
      rows,
      null,
      MODULES,
    );

    expect(planned.idle).toBe(false);
  });
});

describe("a sensor-only gap", () => {
  const rows = [
    { name: "crap", display: "C.R.A.P.", runsTests: false, scoped: false },
  ];
  const gap = (changed: string[], update: string[]) =>
    stub(
      { crap: { kind: "out-of-date", modules: ["c.py"] } },
      { crap: ["c.py"] },
      changed,
      "Update 1 file",
      ["crap"],
      update,
    );
  const ticks: ScanTicks = {
    describe: false,
    analysis: true,
    ticked: ["crap"],
    armed: [],
    onlyView: false,
    suites: {},
    folds: [],
  };

  it("plans one file and shows no canvas banner", () => {
    const model = gap([], ["c.py"]);
    const planned = plannedRun(model, "bring", ticks, rows, null, MODULES);

    expect(planned.modules).toBe(1);
    expect(planned.progress).toBe("Updating 1 file\u2026");
    expect(freshnessMessage(model)).toBeNull();
  });

  it("names one changed file in the banner when Structure changed it", () => {
    const message = freshnessMessage(gap(["a.py"], ["a.py", "c.py"]));

    expect(message?.text.startsWith("1 file has changed")).toBe(true);
  });
});

describe("freshnessMessage", () => {
  it("says nothing when nothing changed and nothing ticked never ran", () => {
    expect(
      freshnessMessage(stub({ crap: CURRENT_STATE }, {}, [], "Up to date")),
    ).toBeNull();
  });

  it("counts the changed files, keys the message by their set and labels the button", () => {
    const one = freshnessMessage(stub({}, {}, ["b.py"], "Update 1 file"));
    const two = freshnessMessage(
      stub({}, {}, ["a.py", "b.py"], "Update 2 files"),
    );

    expect(one?.text).toBe(
      "1 file has changed since it was scanned. Its results are hidden, so this picture is partial.",
    );
    expect(one?.label).toBe("Update 1 file");
    expect(two?.text.startsWith("2 files have changed")).toBe(true);
    expect(one?.key).not.toBe(two?.key);
  });

  it("reports a ticked never-run sensor when nothing changed, and ignores an unticked one", () => {
    const states: Record<string, ResultState> = {
      mutation: { kind: "never-run" },
    };

    expect(
      freshnessMessage(stub(states, {}, [], "Run Mutation")),
    )?.toMatchObject({
      text: "Mutation has not run here yet. Its results are missing from this picture.",
      label: "Run Mutation",
    });
    expect(freshnessMessage(stub(states, {}, [], "Up to date", []))).toBeNull();
  });

  it("words the notice for any scoped sensor by its display name and ignores an unscoped one", () => {
    const states: Record<string, ResultState> = {
      other: { kind: "never-run" },
    };

    expect(
      freshnessMessage(
        stub(states, {}, [], "Run Other", ["other"], [], ["other"]),
      ),
    ).toMatchObject({
      text: "Other has not run here yet. Its results are missing from this picture.",
      label: "Run Other",
    });
    expect(
      freshnessMessage(stub(states, {}, [], "Run Other", ["other"], [], [])),
    ).toBeNull();
    expect(
      freshnessMessage(
        stub(
          { mutation: { kind: "never-run" } },
          {},
          [],
          "Run Mutation",
          ["mutation"],
          [],
          [],
        ),
      ),
    ).toBeNull();
  });
});
