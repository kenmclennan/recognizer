import { describe, expect, it } from "vitest";
import { PlanWorld, scanOf, ticksOf } from "../fakes/plan-world.js";

const FILES = { "a.py": "ha", "b.py": "hb", "c.py": "hc" };
const MODULES = ["a.py", "b.py", "c.py"];
const CURRENT = { inputs: FILES, tests: "t1" };

function world(): PlanWorld {
  const planned = new PlanWorld();

  planned.seedScan(scanOf(FILES, MODULES));
  planned.fakes.store.tests = "t1";
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
  once: ["mutation"],
});

describe("a plan", () => {
  it("a_plan_equals_the_one_planFor_gave", async () => {
    const gapped = world();

    gapped.measure("crap", CURRENT);
    gapped.measure("mutation", {
      inputs: { "a.py": "ha", "b.py": "x", "c.py": "x" },
      tests: "t1",
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
      sense: ["mutation"],
      modules: ["a.py", "b.py", "c.py"],
    });
    expect(union.modules).toBe(3);
    expect(union.idle).toBe(false);
    expect(union.work).toEqual({ describe: 1, mutation: 3 });

    const flagged = world();

    flagged.addSensor("mutation", { runsTests: true, scoped: false });
    flagged.addSensor("other", { runsTests: true, scoped: true });
    flagged.measure("mutation", {
      inputs: { "a.py": "ha", "b.py": "x", "c.py": "x" },
      tests: "t1",
    });
    flagged.measure("other", {
      inputs: { "a.py": "ha", "b.py": "x", "c.py": "hc" },
      tests: "t1",
    });

    const byFlag = await flagged.plan({
      ticks: ticksOf({ ticked: [], once: ["mutation", "other"] }),
      changed: ["b.py", "c.py"],
    });

    expect(byFlag.intent.modules).toEqual(["b.py"]);
    expect(byFlag.work).toEqual({ mutation: 3, other: 1 });

    const unscoped = world();

    unscoped.measure("crap", {
      inputs: { ...FILES, "b.py": "x" },
      tests: "t1",
    });
    unscoped.measure("mutation", CURRENT);

    const plain = await unscoped.plan({
      ticks: ticksOf({ ticked: ["crap"], once: [] }),
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
      ticks: ticksOf({ ticked: [], once: ["mutation"] }),
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
      tests: "t1",
    });

    const gapped = await oneGap.plan({
      ticks: ticksOf({ ticked: ["crap"], once: [] }),
    });

    expect(gapped.gaps.mutation).toEqual(["c.py"]);
    expect(gapped.idle).toBe(false);
  });

  it("a_ticked_name_mixed_registered_and_not", async () => {
    const mixed = world();

    mixed.measure("crap", { inputs: { ...FILES, "a.py": "x" }, tests: "t1" });

    const planned = await mixed.plan({
      ticks: ticksOf({ ticked: ["crap", "ghost", "phantom"], once: [] }),
    });

    expect(planned.intent.sense).toEqual(["crap"]);
    expect(planned.dropped).toEqual(["ghost", "phantom"]);
  });

  it("a_bring_plan_scope_of_one_module_and_of_all", async () => {
    const scoped = world();

    scoped.measure("crap", CURRENT);
    scoped.measure("mutation", {
      inputs: { "a.py": "x", "b.py": "x", "c.py": "x" },
      tests: "t1",
    });

    const own = ticksOf({ ticked: [], once: ["mutation"] });
    const one = await scoped.plan({ ticks: own, scope: ["b.py"] });
    const all = await scoped.plan({ ticks: own });

    expect(one.intent.modules).toEqual(["b.py"]);
    expect(one.work).toEqual({ mutation: 1 });
    expect(all.intent.modules).toEqual(MODULES);
    expect(all.work).toEqual({ mutation: 3 });
  });
});
