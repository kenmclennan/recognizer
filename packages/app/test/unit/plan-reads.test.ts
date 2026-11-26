import { createPlanner } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import {
  type LoadedPlanData,
  latestPlanOnly,
  type PlanRequest,
  planReads,
  type ScanPlanView,
} from "../../src/plan-reads";
import { type DocScan, repositoryFrom } from "./repository-from";

const FILES = { "a.py": "ha", "b.py": "hb", "c.py": "hc" };

const SCAN = repositoryFrom([
  {
    modules: Object.keys(FILES).map((id) => ({
      id,
      members: [{ kind: "function" }],
    })),
    edges: [],
    files: Object.entries(FILES).map(([path, hash]) => ({ path, hash })),
  } as unknown as DocScan,
]);

const DATA: LoadedPlanData = {
  scans: SCAN,
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
    armed: ["mutation"],
    onlyView: false,
    suites: {},
    folds: [],
  },
  scope: null,
  changed: ["a.py", "b.py"],
};

describe("plan reads", () => {
  it("the_reads_hold_what_the_window_loaded", async () => {
    const view = await createPlanner(planReads(DATA))(REQUEST);

    expect(view.intent).toEqual({
      describe: true,
      describeAll: false,
      analysis: true,
      sense: ["crap", "mutation"],
      modules: ["a.py", "b.py"],
    });
    expect(view.gaps).toEqual({
      crap: [],
      mutation: ["b.py"],
      describe: ["a.py"],
    });
    expect(view.never).toEqual([]);
    expect(view.work).toEqual({ describe: 1, crap: 3, mutation: 2 });
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
    const view = await createPlanner(planReads(DATA))(REQUEST);
    const older = ask(REQUEST);
    const newer = ask(REQUEST);

    answers[1]?.(view);
    answers[0]?.(view);

    expect(await newer).toBe(view);
    expect(await older).toBeNull();
  });
});
