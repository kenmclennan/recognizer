import type { RunReport } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { type FakeScan, fakeScan } from "../../src/scan-fake";

function reportsOf(fake: FakeScan): RunReport[] {
  const reports: RunReport[] = [];

  fake.onReport((report) => reports.push(report));

  return reports;
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

const ONE: RunReport = { kind: "extract-current" };
const TWO: RunReport = { kind: "structure", state: "running", files: null };

const PLAN = {
  describe: true,
  analysis: true,
  describeAll: false,
  sense: ["alpha"],
  modules: null,
  suites: {},
};

describe("fakeScan", () => {
  it("delivers the scripted lines as run events in order before the run resolves", async () => {
    const fake = fakeScan({ steps: [ONE, TWO] });
    const reports = reportsOf(fake);

    const result = await fake.run(PLAN);

    expect(reports).toEqual([ONE, TWO]);
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
    const fake = fakeScan({ steps: [ONE, gate, TWO] });
    const reports = reportsOf(fake);
    const phases = phasesOf(fake);

    const pending = fake.run(PLAN);

    await fake.stop();

    expect(await pending).toEqual({ status: "stopped" });
    expect(reports).toEqual([ONE]);
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
      analysis: true,
      ticked: ["alpha"],
      onlyView: false,
      suites: { crap: { ticked: ["unit"], known: ["unit", "web"] } },
      folds: ["crap"],
    });

    expect(await fake.readTicks()).toEqual({
      describe: false,
      analysis: true,
      sensors: true,
      ticked: ["alpha"],
      onlyView: false,
      remembered: true,
      suites: { crap: { ticked: ["unit"], known: ["unit", "web"] } },
      folds: ["crap"],
    });
  });
});
