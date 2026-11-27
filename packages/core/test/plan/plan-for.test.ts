import { describe, expect, it } from "vitest";
import { testsHashOf } from "../../src/index.js";
import {
  PLAN_REPOSITORY,
  PlanWorld,
  scanOf,
  ticksOf,
} from "../fakes/plan-world.js";

const FILES = { "a.py": "ha", "b.py": "hb", "c.py": "hc" };
const MODULES = ["a.py", "b.py", "c.py"];
const TEST_FILE = "test/test_a.py";

function seedTests(planned: PlanWorld, hash: string): string {
  planned.fakes.repositoryFiles.listed = [...MODULES, TEST_FILE];
  planned.fakes.source.hashes.set(`${PLAN_REPOSITORY}/${TEST_FILE}`, hash);

  return testsHashOf(planned.fakes, PLAN_REPOSITORY, new Map()) as string;
}

const T1 = seedTests(new PlanWorld(), "v1");
const CURRENT = { inputs: FILES, tests: T1 };

function world(): PlanWorld {
  const planned = new PlanWorld();

  planned.seedScan(scanOf(FILES, MODULES));
  seedTests(planned, "v1");
  planned.addSensor("crap", { display: "C.R.A.P." });
  planned.addSensor("mutation", {
    display: "Mutation",
    runsTests: true,
    scoped: true,
  });

  return planned;
}

const ticks = ticksOf({
  describe: true,
  ticked: ["crap"],
  armed: ["mutation"],
});

describe("a plan", () => {
  it("a_plan_equals_the_one_planFor_gave", async () => {
    const gapped = world();

    gapped.measure("crap", CURRENT);
    gapped.measure("mutation", {
      inputs: { "a.py": "ha", "b.py": "x", "c.py": "x" },
      tests: T1,
    });
    gapped.describeLines({
      "a.py": "out-of-date",
      "b.py": "current",
      "c.py": "current",
    });

    const union = await gapped.plan({ ticks, changed: MODULES });

    expect(union.intent).toEqual({
      describe: true,
      describeAll: false,
      analysis: true,
      sense: ["crap", "mutation"],
      modules: ["a.py", "b.py", "c.py"],
    });
    expect(union.modules).toBe(3);
    expect(union.idle).toBe(false);
    expect(union.work).toEqual({ describe: 1, crap: 3, mutation: 3 });

    const flagged = world();

    flagged.addSensor("mutation", { runsTests: true, scoped: false });
    flagged.addSensor("other", { runsTests: true, scoped: true });
    flagged.measure("mutation", {
      inputs: { "a.py": "ha", "b.py": "x", "c.py": "x" },
      tests: T1,
    });
    flagged.measure("other", {
      inputs: { "a.py": "ha", "b.py": "x", "c.py": "hc" },
      tests: T1,
    });

    const byFlag = await flagged.plan({
      ticks: ticksOf({ ticked: [], armed: ["mutation", "other"] }),
      changed: ["b.py", "c.py"],
    });

    expect(byFlag.intent.modules).toEqual(["b.py", "c.py"]);
    expect(byFlag.work).toEqual({ mutation: 3, other: 2 });

    const unscoped = world();

    unscoped.measure("crap", {
      inputs: { ...FILES, "b.py": "x" },
      tests: T1,
    });
    unscoped.measure("mutation", CURRENT);

    const plain = await unscoped.plan({
      ticks: ticksOf({ ticked: ["crap"], armed: [] }),
      changed: ["b.py"],
    });

    expect(plain.intent).toEqual({
      describe: false,
      describeAll: false,
      analysis: true,
      sense: ["crap"],
      modules: null,
    });

    const never = await world().plan({
      ticks: ticksOf({ ticked: [], armed: ["mutation"] }),
    });

    expect(never.intent.sense).toEqual(["mutation"]);
    expect(never.intent.modules).toEqual(MODULES);
    expect(never.never).toEqual(["crap", "mutation"]);

    const rescanned = await world().plan({
      mode: "rescan",
      ticks,
      scope: ["a.py", "b.py"],
    });

    expect(rescanned.intent).toEqual({
      describe: true,
      describeAll: true,
      analysis: true,
      sense: ["crap", "mutation"],
      modules: ["a.py", "b.py"],
    });
    expect(rescanned.idle).toBe(false);

    const whole = await world().plan({ mode: "rescan", ticks });

    expect(whole.intent.modules).toBeNull();

    for (const planned of [union, byFlag, plain, never, rescanned]) {
      expect(planned.intent.sense.length).toBeGreaterThan(0);
      expect(planned.work).not.toEqual({});
    }
  });

  it("idle_needs_no_phase_no_gap_and_no_changed_file", async () => {
    const current = world();

    current.measure("crap", CURRENT);
    current.measure("mutation", CURRENT);
    current.describeLines({
      "a.py": "current",
      "b.py": "current",
      "c.py": "current",
    });

    const quiet = await current.plan({ ticks });

    expect(quiet.idle).toBe(true);
    expect(quiet.intent.sense).toEqual([]);
    expect(quiet.intent.describe).toBe(false);
    expect(quiet.gaps).toEqual({ crap: [], mutation: [], describe: [] });

    const changed = await current.plan({ ticks, changed: ["a.py"] });

    expect(changed.idle).toBe(false);

    const oneGap = world();

    oneGap.measure("crap", CURRENT);
    oneGap.measure("mutation", {
      inputs: { ...FILES, "c.py": "x" },
      tests: T1,
    });

    const gapped = await oneGap.plan({
      ticks: ticksOf({ ticked: ["crap"], armed: [] }),
    });

    expect(gapped.gaps.mutation).toEqual(["c.py"]);
    expect(gapped.idle).toBe(false);
  });

  it("a_bring_after_an_edit_plans_every_ticked_sensor_over_the_changed_files", async () => {
    const edited = world();

    edited.measure("crap", CURRENT);
    edited.measure("mutation", CURRENT);

    const planned = await edited.plan({
      ticks: ticksOf({ ticked: ["crap"], armed: ["mutation"] }),
      changed: ["a.py"],
    });

    expect(planned.intent.sense).toEqual(["crap", "mutation"]);
    expect(planned.intent.modules).toEqual(["a.py"]);
    expect(planned.work).toEqual({ crap: 3, mutation: 1 });
    expect(planned.idle).toBe(false);
    expect(planned.gaps).toEqual({ crap: [], mutation: [] });
  });

  it("a_bring_with_no_edit_stays_idle", async () => {
    const current = world();

    current.measure("crap", CURRENT);
    current.measure("mutation", CURRENT);

    const planned = await current.plan({
      ticks: ticksOf({ ticked: ["crap"], armed: ["mutation"] }),
      changed: [],
    });

    expect(planned.gaps).toEqual({ crap: [], mutation: [] });
    expect(planned.intent.sense).toEqual([]);
    expect(planned.idle).toBe(true);
  });

  it("a_bring_unites_recorded_gaps_with_changed_files", async () => {
    const mixed = world();

    mixed.measure("crap", CURRENT);
    mixed.measure("mutation", {
      inputs: { ...FILES, "b.py": "x" },
      tests: T1,
    });

    const planned = await mixed.plan({
      ticks: ticksOf({ ticked: ["crap"], armed: ["mutation"] }),
      changed: ["a.py"],
    });

    expect(planned.intent.modules).toEqual(["a.py", "b.py"]);
    expect(planned.work.mutation).toBe(2);
  });

  it("a_ticked_name_mixed_registered_and_not", async () => {
    const mixed = world();

    mixed.measure("crap", { inputs: { ...FILES, "a.py": "x" }, tests: T1 });

    const planned = await mixed.plan({
      ticks: ticksOf({ ticked: ["crap", "ghost", "phantom"], armed: [] }),
    });

    expect(planned.intent.sense).toEqual(["crap"]);
    expect(planned.dropped).toEqual(["ghost", "phantom"]);
  });

  it("a_bring_plan_scope_of_one_module_and_of_all", async () => {
    const scoped = world();

    scoped.measure("crap", CURRENT);
    scoped.measure("mutation", {
      inputs: { "a.py": "x", "b.py": "x", "c.py": "x" },
      tests: T1,
    });

    const own = ticksOf({ ticked: [], armed: ["mutation"] });
    const one = await scoped.plan({ ticks: own, scope: ["b.py"] });
    const all = await scoped.plan({ ticks: own });

    expect(one.intent.modules).toEqual(["b.py"]);
    expect(one.work).toEqual({ mutation: 1 });
    expect(all.intent.modules).toEqual(MODULES);
    expect(all.work).toEqual({ mutation: 3 });
  });

  it("a_changed_test_file_makes_a_digest_carrying_result_out_of_date", async () => {
    const edited = world();

    edited.measure("crap", CURRENT);

    const own = ticksOf({ ticked: ["crap"], armed: [] });
    const before = await edited.plan({ ticks: own });

    expect(before.gaps.crap).toEqual([]);

    seedTests(edited, "v2");

    const after = await edited.plan({ ticks: own });

    expect(after.gaps.crap).toEqual(MODULES);
    expect(after.idle).toBe(false);
  });

  it("a_result_without_a_digest_stays_current_after_a_test_edit", async () => {
    const edited = world();

    edited.addSensor("structure", { display: "Structure" });
    edited.measure("structure", { inputs: FILES });
    seedTests(edited, "v2");

    const planned = await edited.plan({
      ticks: ticksOf({ ticked: ["structure"], armed: [] }),
    });

    expect(planned.gaps.structure).toEqual([]);
  });

  it("an_unknown_digest_gaps_digest_carrying_results_and_no_others", async () => {
    const unknown = world();

    unknown.addSensor("structure", { display: "Structure" });
    unknown.measure("crap", CURRENT);
    unknown.measure("structure", { inputs: FILES });
    unknown.fakes.repositoryFiles.listed = null;

    const planned = await unknown.plan({
      ticks: ticksOf({ ticked: ["crap", "structure"], armed: [] }),
    });

    expect(planned.gaps.crap).toEqual(MODULES);
    expect(planned.gaps.structure).toEqual([]);
    expect(planned.never).toEqual(["mutation"]);
  });

  it("the_first_result_in_order_no_longer_decides", async () => {
    const mixed = world();

    mixed.measure("crap", CURRENT);
    mixed.measure("mutation", { inputs: FILES, tests: "old" });

    const planned = await mixed.plan({
      ticks: ticksOf({ ticked: ["crap"], armed: ["mutation"] }),
    });

    expect(planned.gaps.crap).toEqual([]);
    expect(planned.gaps.mutation).toEqual(MODULES);
  });
});
