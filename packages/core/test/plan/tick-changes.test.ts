import { describe, expect, it } from "vitest";
import {
  afterSuiteTick,
  afterTickChanges,
  type ScanTicks,
} from "../../src/index.js";

const START: ScanTicks = {
  describe: false,
  analysis: true,
  ticked: null,
  armed: [],
  onlyView: false,
  suites: {},
  folds: [],
};

const SUITES = ["unit", "web"];

describe("tick changes", () => {
  it("applies each change to the result of the one before", () => {
    const once = afterSuiteTick(START, "crap", "unit", true, SUITES);
    const twice = afterSuiteTick(once, "crap", "web", true, SUITES);

    expect(
      afterTickChanges(START, [
        {
          kind: "suite",
          sensor: "crap",
          suite: "unit",
          ticked: true,
          suites: SUITES,
        },
        {
          kind: "suite",
          sensor: "crap",
          suite: "web",
          ticked: true,
          suites: SUITES,
        },
      ]),
    ).toEqual(twice);
    expect(twice.suites.crap?.ticked).toEqual(["unit", "web"]);
  });

  it("arms a sensor without suites and unarms it", () => {
    const on = afterTickChanges(START, [
      { kind: "sensor", sensor: "crap", ticked: true, suites: [] },
    ]);

    expect(on.armed).toEqual(["crap"]);
    expect(
      afterTickChanges(on, [
        { kind: "sensor", sensor: "crap", ticked: false, suites: [] },
      ]).armed,
    ).toEqual([]);
  });

  it("ticks a sensor with suites through the suite rule", () => {
    const on = afterTickChanges(START, [
      { kind: "sensor", sensor: "crap", ticked: true, suites: SUITES },
    ]);

    expect(on.armed).toEqual(["crap"]);
    expect(on.suites.crap?.ticked).toEqual(SUITES);
  });

  it("ticks a plain sensor from the plain list when none is stored", () => {
    expect(
      afterTickChanges(START, [
        { kind: "plain", sensor: "a", ticked: false, plain: ["a", "b"] },
      ]).ticked,
    ).toEqual(["b"]);
  });

  it("sets describe, analysis and only-view, toggles a fold and closes folds on open", () => {
    const set = afterTickChanges(START, [
      { kind: "describe", ticked: true },
      { kind: "analysis", ticked: false },
      { kind: "onlyView", on: true },
      { kind: "fold", sensor: "crap" },
    ]);

    expect(set).toMatchObject({
      describe: true,
      analysis: false,
      onlyView: true,
      folds: ["crap"],
    });
    expect(afterTickChanges(set, [{ kind: "open" }]).folds).toEqual([]);
  });
});
