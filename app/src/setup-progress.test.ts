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
  line({
    event: "phase",
    phase: "extract",
    state: "run",
    commit: null,
    languages: ["typescript", "python"],
  }),
  line({
    event: "plugin",
    phase: "extract",
    name: "typescript",
    data: { event: "start", total: 125, unit: "files" },
  }),
  line({
    event: "entry",
    phase: "extract",
    name: "typescript",
    outcome: "ok",
    modules: 3,
    edges: 2,
  }),
  line({
    event: "plugin",
    phase: "extract",
    name: "python",
    data: { event: "start", total: 9, unit: "files" },
  }),
  line({
    event: "entry",
    phase: "extract",
    name: "python",
    outcome: "ok",
    modules: 1,
    edges: 0,
  }),
  line({ event: "structure", state: "run" }),
  line({ event: "structure", state: "done", files: 134 }),
  step("scan", "done"),
  step("reading", "run"),
  step("reading", "done"),
];

describe("the loading reducer", () => {
  it("keeps the third row waiting until the scan row has finished", () => {
    const early = run([
      ...UNSCANNED.slice(0, 5),
      step("reading", "run"),
      step("survey", "done"),
    ]);

    expect(early.scan?.state).toBe("running");
    expect(early.reading.state).toBe("waiting");
    expect(early.reading.startedAt).toBeNull();

    const settled = run([
      ...UNSCANNED.slice(0, 5),
      step("reading", "run"),
      step("reading", "done"),
      step("scan", "done"),
    ]);

    expect(settled.scan?.state).toBe("done");
    expect(settled.reading.state).toBe("done");
    expect(settled.reading.startedAt).toBeGreaterThanOrEqual(
      settled.scan?.endedAt ?? Infinity,
    );
  });

  it("gives the rows, the language lines and the duplication line", () => {
    const state = run(UNSCANNED.slice(0, 5));

    expect(state.survey.state).toBe("done");
    expect(state.scan?.state).toBe("running");
    expect(state.reading.state).toBe("waiting");
    expect(state.languages).toEqual([
      { name: "typescript", state: "reading", files: 125 },
      { name: "python", state: "waiting", files: null },
    ]);
    expect(state.duplication).toBeNull();

    const end = run(UNSCANNED);

    expect(end.languages).toEqual([
      { name: "typescript", state: "done", files: 125 },
      { name: "python", state: "done", files: 9 },
    ]);
    expect(end.duplication).toEqual({ state: "done", files: 134 });
    expect(end.scan?.state).toBe("done");
    expect(end.reading.state).toBe("done");
  });

  it("has no scan row until a scan step line arrives", () => {
    const state = run([step("survey", "run"), step("survey", "done")]);

    expect(state.scan).toBeNull();
  });

  it("records a failed duplication run", () => {
    const state = run([
      line({ event: "structure", state: "run" }),
      line({ event: "structure", state: "failed", files: 4 }),
    ]);

    expect(state.duplication).toEqual({ state: "failed", files: 4 });
  });

  it("finishes the scan row on phase extract current with no language lines", () => {
    const state = run([
      step("scan", "run"),
      line({ event: "phase", phase: "extract", state: "current", commit: "a" }),
    ]);

    expect(state.scan?.state).toBe("done");
    expect(state.languages).toEqual([]);
  });

  it("ignores lines that do not parse and events it does not use", () => {
    const before = run(UNSCANNED.slice(0, 3));
    const after = run([
      ...UNSCANNED.slice(0, 3),
      "not json",
      "",
      "[1]",
      line({ event: "preflight", state: "ok" }),
      line({
        event: "plugin",
        phase: "sense",
        name: "crap",
        data: { event: "note", text: "x" },
      }),
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

  it("does not move back when the language list raises the total", () => {
    const before = run(UNSCANNED.slice(0, 3));
    const after = reduceLoading(before, UNSCANNED[3] as string, 1);

    expect(after.fill).toBeGreaterThanOrEqual(before.fill);
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

  it("counts the scan as one language before the languages arrive", () => {
    const state = run([
      step("scan", "run"),
      step("survey", "run"),
      step("survey", "done"),
    ]);

    expect(state.fill).toBeCloseTo(1 / 4);
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
