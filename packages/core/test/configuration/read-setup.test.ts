import { describe, expect, it } from "vitest";
import { readSetup } from "../../src/index.js";
import { ROOT, scanOfFiles, worldOf } from "./world.js";

const step = (name: string, state: string) =>
  JSON.stringify({ event: "step", step: name, state });

describe("readSetup", () => {
  it("the step lines arrive survey, scan, reading on an unscanned folder", async () => {
    const world = worldOf();
    const lines: string[] = [];

    world.fakes.setupScan.lines = ["feed line"];

    const read = await readSetup(world.ports, {
      root: ROOT,
      extract: true,
      onLine: (line) => lines.push(line),
    });

    expect(read.status).toBe("ok");
    expect(lines).toEqual([
      step("survey", "run"),
      step("survey", "done"),
      step("scan", "run"),
      "feed line",
      step("scan", "done"),
      step("reading", "run"),
      step("reading", "done"),
    ]);
    expect(world.fakes.setupScan.calls).toEqual([ROOT]);
    expect(world.fakes.surveyPlugins.requests).toHaveLength(2);
  });

  it("the step lines arrive survey, reading on a scanned folder", async () => {
    const world = worldOf();
    const lines: string[] = [];

    const read = await readSetup(world.ports, {
      root: ROOT,
      extract: true,
      scan: scanOfFiles(["a.ts"]),
      onLine: (line) => lines.push(line),
    });

    expect(read.status).toBe("ok");
    expect(lines).toEqual([
      step("survey", "run"),
      step("survey", "done"),
      step("reading", "run"),
      step("reading", "done"),
    ]);
    expect(world.fakes.setupScan.calls).toEqual([]);
  });

  it("does not scan when extract is off", async () => {
    const world = worldOf();

    await readSetup(world.ports, {
      root: ROOT,
      extract: false,
      onLine: () => {},
    });

    expect(world.fakes.setupScan.calls).toEqual([]);
  });

  it("is unavailable with the reason when the scan fails", async () => {
    const world = worldOf();

    world.fakes.setupScan.outcome = { ok: false, reason: "scan broke" };

    expect(
      await readSetup(world.ports, {
        root: ROOT,
        extract: true,
        onLine: () => {},
      }),
    ).toEqual({ status: "unavailable", reason: "scan broke" });
  });

  it("is unavailable when the survey cannot read the folder", async () => {
    const world = worldOf();

    expect(
      await readSetup(world.ports, {
        root: "/work/missing",
        extract: false,
        onLine: () => {},
      }),
    ).toEqual({
      status: "unavailable",
      reason: "repository is not a directory: /work/missing",
    });
  });

  it("reads the doctor report as unavailable when the doctor cannot run", async () => {
    const world = worldOf();

    const diagnose = world.ports.reads.diagnose;
    let calls = 0;

    world.ports.reads.diagnose = (root) => {
      calls += 1;

      if (calls > 1) {
        throw new Error("doctor did not answer");
      }

      return diagnose(root);
    };

    const read = await readSetup(world.ports, {
      root: ROOT,
      extract: false,
      onLine: () => {},
    });

    expect(read).toMatchObject({
      status: "ok",
      doctor: {
        status: "unavailable",
        reason: "doctor did not answer",
      },
    });
  });
});
