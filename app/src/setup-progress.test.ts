import { describe, expect, it } from "vitest";
import {
  applyFill,
  elapsedText,
  type LoadingState,
  loadingFill,
  reduceLoading,
  startLoading,
} from "./setup-progress";

const line = (value: unknown) => JSON.stringify(value);

function run(lines: string[], at = 0): LoadingState {
  let clock = at;

  return lines.reduce((state, text) => {
    clock += 100;

    return reduceLoading(state, text, clock);
  }, startLoading(at));
}

const step = (name: string, state: "run" | "done") =>
  line({ event: "step", step: name, state });

const UNSCANNED = [
  step("survey", "run"),
  step("survey", "done"),
  step("scan", "run"),
  step("scan", "done"),
  step("reading", "run"),
  step("reading", "done"),
];

describe("the loading reducer", () => {
  it("gives the three rows their states as the step lines arrive", () => {
    const state = run(UNSCANNED.slice(0, 3));

    expect(state.survey.state).toBe("done");
    expect(state.scan?.state).toBe("running");
    expect(state.reading.state).toBe("waiting");

    const end = run(UNSCANNED);

    expect(end.scan?.state).toBe("done");
    expect(end.reading.state).toBe("done");
  });

  it("has no scan row until a scan step line arrives", () => {
    const state = run([step("survey", "run"), step("survey", "done")]);

    expect(state.scan).toBeNull();
  });

  it("ignores lines that do not parse and events it does not use", () => {
    const before = run(UNSCANNED.slice(0, 3));
    const after = run([
      ...UNSCANNED.slice(0, 3),
      "not json",
      "",
      "[1]",
      line({ event: "preflight", state: "ok" }),
    ]);

    expect({ ...after, fill: 0 }).toEqual({ ...before, fill: 0 });
  });

  it("records row times from the clock handed in", () => {
    const state = run([step("survey", "run"), step("survey", "done")], 1000);

    expect(state.survey).toEqual({
      state: "done",
      startedAt: 1100,
      endedAt: 1200,
    });
  });
});

describe("the loading bar", () => {
  it("never decreases as the line sequence runs", () => {
    let state = startLoading(0);
    let last = 0;

    for (const text of UNSCANNED) {
      state = reduceLoading(state, text, 1);

      expect(state.fill).toBeGreaterThanOrEqual(last);

      last = state.fill;
    }
  });

  it("lands exactly on 100% when every unit is done", () => {
    expect(run(UNSCANNED).fill).toBe(1);
    expect(loadingFill(run(UNSCANNED))).toBe(1);
  });

  it("counts two units when no scan runs", () => {
    const half = run([step("survey", "run"), step("survey", "done")]);
    const whole = run([
      step("survey", "run"),
      step("survey", "done"),
      step("reading", "run"),
      step("reading", "done"),
    ]);

    expect(half.fill).toBe(0.5);
    expect(whole.fill).toBe(1);
  });

  it("counts three units when a scan runs", () => {
    const state = run([
      step("scan", "run"),
      step("survey", "run"),
      step("survey", "done"),
    ]);

    expect(state.fill).toBeCloseTo(1 / 3);
  });
});

describe("the apply bar", () => {
  it("is done commands over all commands", () => {
    expect(applyFill(3, 1, 0, 2)).toBeCloseTo(1 / 3);
    expect(applyFill(3, 3, 2, 2)).toBe(1);
  });

  it("falls back to finished changes when no command event arrives", () => {
    expect(applyFill(null, 0, 1, 2)).toBe(0.5);
    expect(applyFill(0, 0, 1, 4)).toBe(0.25);
  });
});

describe("elapsed text", () => {
  it("shows one decimal second under a minute and minutes after", () => {
    expect(elapsedText(1234)).toBe("1.2s");
    expect(elapsedText(-5)).toBe("0.0s");
    expect(elapsedText(125000)).toBe("2m 5s");
  });
});
