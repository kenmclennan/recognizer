import { describe, expect, it } from "vitest";
import {
  type LoadedPlanData,
  latestPlanOnly,
  type PlanRequest,
  type ScanFacts,
  type ScanPlanView,
} from "../../src/plan-reads";
import { planThrough } from "../../src/scan-fake";

const FILES = { "a.py": "ha", "b.py": "hb", "c.py": "hc" };

const SCAN: ScanFacts = {
  modules: Object.keys(FILES).map((id) => ({
    id,
    members: [{ kind: "function" }],
  })),
  files: Object.entries(FILES).map(([path, hash]) => ({ path, hash })),
};

const DATA: LoadedPlanData = {
  scans: [SCAN],
  measured: {
    crap: { inputs: FILES, tests: "t1" },
    mutation: { inputs: { ...FILES, "b.py": "x" }, tests: "t1" },
  },
  tests: "t1",
  describerRegistered: true,
  lineKinds: (id) => (id === "a.py" ? "out-of-date" : "current"),
  sensors: [
    {
      name: "crap",
      display: "C.R.A.P.",
      runsTests: false,
      scoped: false,
      registered: true,
    },
    {
      name: "mutation",
      display: "Mutation",
      runsTests: true,
      scoped: true,
      registered: true,
    },
  ],
};

const REQUEST: PlanRequest = {
  repository: "/repo",
  mode: "bring",
  ticks: {
    describe: true,
    analysis: true,
    ticked: ["crap"],
    once: ["mutation"],
    onlyView: false,
    suites: {},
    folds: [],
  },
  scope: null,
  changed: ["a.py", "b.py"],
};

describe("plan reads", () => {
  it("the_reads_hold_what_the_window_loaded", async () => {
    const view = await planThrough(DATA)(REQUEST);

    expect(view.intent).toEqual({
      describe: true,
      describeAll: false,
      analysis: true,
      sense: ["mutation"],
      modules: ["a.py", "b.py"],
    });
    expect(view.gaps).toEqual({
      crap: [],
      mutation: ["b.py"],
      describe: ["a.py"],
    });
    expect(view.never).toEqual([]);
    expect(view.work).toEqual({ describe: 1, mutation: 2 });
    expect(view.modules).toBe(2);
  });

  it("drops a reply that arrives after a newer request", async () => {
    const answers: ((view: ScanPlanView) => void)[] = [];
    const ask = latestPlanOnly(
      () =>
        new Promise<ScanPlanView>((resolve) => {
          answers.push(resolve);
        }),
    );
    const view = await planThrough(DATA)(REQUEST);
    const older = ask(REQUEST);
    const newer = ask(REQUEST);

    answers[1]?.(view);
    answers[0]?.(view);

    expect(await newer).toBe(view);
    expect(await older).toBeNull();
  });
});
