import { describe, expect, it } from "vitest";
import {
  afterFoldToggle,
  afterPanelOpen,
  afterSensorTick,
  afterSuiteTick,
  onlyArmed,
  type ScanTicks,
  sensorTickState,
  suiteIsTicked,
  tickedPhases,
  tickedSuites,
} from "../../src/index.js";

const ALL = ["unit", "integration", "web"];

function ticks(over: Partial<ScanTicks> = {}): ScanTicks {
  return {
    describe: false,
    analysis: true,
    ticked: [],
    armed: [],
    onlyView: false,
    suites: {},
    folds: [],
    ...over,
  };
}

const entry = (ticked: string[], known: string[] = ALL) => ({ ticked, known });

describe("suite ticks", () => {
  it("reads a suite as ticked when it is in ticked or new to the config, and none when the sensor has no entry", () => {
    const suites = { crap: entry(["unit"], ["unit", "web"]) };

    expect(suiteIsTicked(suites, "crap", "unit")).toBe(true);
    expect(suiteIsTicked(suites, "crap", "web")).toBe(false);
    expect(suiteIsTicked(suites, "crap", "e2e")).toBe(true);
    expect(suiteIsTicked(suites, "mutation", "unit")).toBe(false);
    expect(tickedSuites(suites, "crap", ["unit", "web", "e2e"])).toEqual([
      "unit",
      "e2e",
    ]);
    expect(tickedSuites({}, "crap", ALL)).toEqual([]);
  });

  it("reads the sensor tick as on, some or off from armed and the suite ticks", () => {
    const armed = ["crap"];

    expect(
      sensorTickState({ armed, suites: { crap: entry(ALL) } }, "crap", ALL),
    ).toBe("on");
    expect(
      sensorTickState(
        { armed, suites: { crap: entry(["unit"]) } },
        "crap",
        ALL,
      ),
    ).toBe("some");
    expect(
      sensorTickState({ armed, suites: { crap: entry([]) } }, "crap", ALL),
    ).toBe("off");
    expect(sensorTickState({ armed, suites: {} }, "crap", ALL)).toBe("off");
  });

  it("reads the sensor tick off when it is not in armed even with every suite ticked", () => {
    expect(
      sensorTickState({ armed: [], suites: { crap: entry(ALL) } }, "crap", ALL),
    ).toBe("off");
  });

  it("arms a sensor by ticking every suite, whatever selection was remembered", () => {
    const none = afterSensorTick(ticks(), "crap", ALL);

    expect(none.armed).toEqual(["crap"]);
    expect(none.suites.crap).toEqual(entry(ALL));

    const some = afterSensorTick(
      ticks({ suites: { crap: entry(["unit"]) } }),
      "crap",
      ALL,
    );

    expect(some.armed).toEqual(["crap"]);
    expect(some.suites.crap?.ticked).toEqual(ALL);
  });

  it("disarms an on or some sensor and unticks every one of its suites", () => {
    const armed = ticks({
      armed: ["crap", "mutation"],
      suites: { crap: entry(["unit", "web"]), mutation: entry(ALL) },
    });
    const next = afterSensorTick(armed, "crap", ALL);

    expect(next.armed).toEqual(["mutation"]);
    expect(next.suites.crap?.ticked).toEqual([]);
    expect(next.suites.mutation).toEqual(entry(ALL));
    expect(sensorTickState(next, "crap", ALL)).toBe("off");
  });

  it("ticks every suite when the sensor is ticked, whatever was remembered", () => {
    const next = afterSensorTick(
      ticks({ suites: { crap: entry(["unit"]) } }),
      "crap",
      ALL,
    );

    expect(next.armed).toEqual(["crap"]);
    expect(next.suites.crap?.ticked).toEqual(ALL);
    expect(sensorTickState(next, "crap", ALL)).toBe("on");
  });

  it("arms an unticked sensor with only the suite ticked, ignoring stale suite ticks", () => {
    const next = afterSuiteTick(
      ticks({ suites: { crap: entry(ALL) } }),
      "crap",
      "web",
      true,
      ALL,
    );

    expect(next.armed).toEqual(["crap"]);
    expect(next.suites.crap?.ticked).toEqual(["web"]);
    expect(sensorTickState(next, "crap", ALL)).toBe("some");
  });

  it("disarms the sensor when the last ticked suite is unticked", () => {
    const armed = ticks({
      armed: ["crap", "mutation"],
      suites: { crap: entry(["web"]) },
    });
    const next = afterSuiteTick(armed, "crap", "web", false, ALL);

    expect(next.armed).toEqual(["mutation"]);
    expect(sensorTickState(next, "crap", ALL)).toBe("off");
  });

  it("opens the panel with every fold closed", () => {
    const open = ticks({ folds: ["crap", "mutation"] });

    expect(afterPanelOpen(open).folds).toEqual([]);
    expect(afterPanelOpen(ticks())).toEqual(ticks());
  });

  it("toggles a suite, stores every configured suite as known and arms its sensor on ticking", () => {
    const next = afterSuiteTick(ticks(), "crap", "web", true, ALL);

    expect(next.suites.crap).toEqual({ ticked: ["web"], known: ALL });
    expect(next.armed).toEqual(["crap"]);

    const off = afterSuiteTick(next, "crap", "web", false, ALL);

    expect(off.suites.crap?.ticked).toEqual([]);
    expect(off.armed).toEqual([]);
    expect(sensorTickState(off, "crap", ALL)).toBe("off");
  });

  it("keeps each sensor's suite ticks independent", () => {
    const next = afterSuiteTick(
      ticks({ suites: { mutation: entry(["web"]) } }),
      "crap",
      "unit",
      true,
      ALL,
    );

    expect(next.suites.crap?.ticked).toEqual(["unit"]);
    expect(next.suites.mutation).toEqual(entry(["web"]));
  });

  it("keeps folds closed by default and remembers the ones toggled open", () => {
    expect(ticks().folds).toEqual([]);

    const open = afterFoldToggle(ticks(), "mutation");

    expect(open.folds).toEqual(["mutation"]);
    expect(afterFoldToggle(open, "mutation").folds).toEqual([]);
    expect(afterSensorTick(open, "crap", ALL).folds).toEqual(["mutation"]);
  });
});

describe("phasesFor with suites", () => {
  const suites = ALL.map((name) => ({
    name,
    language: name === "web" ? "typescript" : "python",
  }));
  const rows = [
    {
      name: "crap",
      display: "C.R.A.P.",
      runsTests: true,
      scoped: false,
      registered: true,
      suites,
    },
    {
      name: "duplication",
      display: "Duplication",
      runsTests: false,
      scoped: false,
      registered: false,
    },
    {
      name: "mutation",
      display: "Mutation",
      runsTests: true,
      scoped: false,
      registered: true,
      suites,
    },
  ];

  it("leaves a sensor out of sense when it is not in armed however its suites are ticked", () => {
    const plan = tickedPhases(ticks({ suites: { crap: entry(ALL) } }), rows);

    expect(plan.sense).toEqual([]);
    expect(plan.suites).toEqual({});
  });

  it("leaves a sensor out of sense when it is in armed with no suite ticked", () => {
    const plan = tickedPhases(
      ticks({ armed: ["crap"], suites: { crap: entry([]) } }),
      rows,
    );

    expect(plan.sense).toEqual([]);
  });

  it("returns the ticked suites in config order for each armed sensor", () => {
    const plan = tickedPhases(
      ticks({
        armed: ["crap", "mutation"],
        suites: {
          crap: entry(["web", "unit"]),
          mutation: entry(["integration"]),
        },
      }),
      rows,
    );

    expect(plan.sense).toEqual(["crap", "mutation"]);
    expect(plan.suites).toEqual({
      crap: ["unit", "web"],
      mutation: ["integration"],
    });
  });
});

describe("onlyArmed", () => {
  const plan = {
    describe: false,
    describeAll: false,
    analysis: true,
    sense: ["mutation", "crap", "alpha"],
    modules: null,
    suites: { mutation: ["unit"], crap: ["unit"] },
  };
  const testing = ["crap", "mutation"];

  it("drops an unarmed test-running sensor and its suites and keeps the armed one", () => {
    expect(plan.sense[0]).toBe("mutation");
    expect(plan.suites.mutation).toEqual(["unit"]);

    const result = onlyArmed(plan, ["crap"], testing);

    expect(result.sense).toEqual(["crap", "alpha"]);
    expect(result.suites).toEqual({ crap: ["unit"] });
  });

  it("returns the plan unchanged when every test-running sensor is armed", () => {
    expect(onlyArmed(plan, ["crap", "mutation"], testing)).toEqual(plan);
  });

  it("keeps only plain sensors when none is armed", () => {
    const result = onlyArmed(plan, [], testing);

    expect(result.sense).toEqual(["alpha"]);
    expect(result.suites).toEqual({});
  });

  it("keeps a plain sensor that is not armed", () => {
    expect(onlyArmed({ ...plan, sense: ["alpha"] }, [], testing).sense).toEqual(
      ["alpha"],
    );
  });
});
