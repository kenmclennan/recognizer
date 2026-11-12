import { describe, expect, it } from "vitest";
import { type FakeScan, fakeScan } from "./scan-fake";

function linesOf(fake: FakeScan): string[] {
  const lines: string[] = [];

  fake.onRun((event) => {
    if (event.kind === "line") {
      lines.push(event.line);
    }
  });

  return lines;
}

function phasesOf(fake: FakeScan): string[] {
  const phases: string[] = [];

  fake.onRun((event) => {
    if (event.kind === "run" && event.run !== null) {
      phases.push(event.run.phase);
    }
  });

  return phases;
}

const PLAN = {
  describe: true,
  describeAll: false,
  sense: ["alpha"],
  modules: null,
  suites: {},
};

describe("fakeScan", () => {
  it("delivers the scripted lines as run events in order before the run resolves", async () => {
    const fake = fakeScan({ steps: ["one", "two"] });
    const lines = linesOf(fake);

    const result = await fake.run(PLAN);

    expect(lines).toEqual(["one", "two"]);
    expect(result).toEqual({
      status: "finished",
      exitCode: 0,
    });
    expect(fake.ran).toEqual([PLAN]);
  });

  it("refuses a second run while one is pending", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = fakeScan({ steps: [gate] });
    const first = fake.run(PLAN);
    const second = await fake.run(PLAN);

    expect(second).toEqual({
      status: "refused",
      reason: "a scan is already running",
    });

    release();
    await first;
  });

  it("stops the pending run, delivers the stopped record and no further lines", async () => {
    const gate = new Promise<void>(() => {});
    const fake = fakeScan({ steps: ["one", gate, "two"] });
    const lines = linesOf(fake);
    const phases = phasesOf(fake);

    const pending = fake.run(PLAN);

    await fake.stop();

    expect(await pending).toEqual({ status: "stopped" });
    expect(lines).toEqual(["one"]);
    expect(phases).toEqual(["checking", "stopped"]);
    expect(fake.stopped).toBe(1);
  });

  it("reads nothing ticked as not remembered until ticks are written", async () => {
    const fake = fakeScan();

    expect(await fake.readTicks()).toEqual({
      describe: false,
      sensors: false,
      ticked: [],
      remembered: false,
      suites: {},
      folds: [],
    });

    await fake.writeTicks({
      describe: false,
      ticked: ["alpha"],
      onlyView: false,
      suites: { crap: { ticked: ["unit"], known: ["unit", "web"] } },
      folds: ["crap"],
    });

    expect(await fake.readTicks()).toEqual({
      describe: false,
      sensors: true,
      ticked: ["alpha"],
      onlyView: false,
      remembered: true,
      suites: { crap: { ticked: ["unit"], known: ["unit", "web"] } },
      folds: ["crap"],
    });
  });
});
