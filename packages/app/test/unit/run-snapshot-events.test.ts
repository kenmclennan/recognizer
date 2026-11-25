import type { PluginFailure, PluginRunState, RunView } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { sensorEventsBetween } from "../../src/run-snapshot-events";

function run(
  id: string,
  plugins: [string, PluginRunState][],
  progress: Record<string, { done: number; total: number; unit: string }> = {},
  failures: Record<string, PluginFailure> = {},
): RunView {
  return {
    id,
    startedBy: "app",
    startedAt: "2026-11-24T00:00:00.000Z",
    scope: { kind: "working-tree" },
    sensors: plugins.map(([name]) => name),
    describe: false,
    suites: {},
    state: "running",
    endedAt: null,
    exit: null,
    gaps: [],
    failure: null,
    ran: null,
    plugins: plugins.map(([name, state]) => ({
      name,
      state,
      progress: progress[name] ?? null,
      stage: null,
      estimateMs: null,
      failure: failures[name] ?? null,
    })),
  };
}

describe("sensorEventsBetween", () => {
  it("names the sense phase and a start when the first plugin begins", () => {
    const before = run("r1", [["a", "queued"]]);
    const after = run("r1", [["a", "running"]]);

    expect(sensorEventsBetween(before, after)).toEqual([
      { event: "phase", phase: "sense", total: 1 },
      { event: "start", phase: "sense", name: "a" },
    ]);
  });

  it("reports an entry once when a plugin ends and nothing when nothing changed", () => {
    const before = run("r1", [
      ["a", "running"],
      ["b", "queued"],
    ]);
    const after = run("r1", [
      ["a", "finished"],
      ["b", "running"],
    ]);

    expect(sensorEventsBetween(before, after).map((e) => e.event)).toEqual([
      "entry",
      "start",
    ]);
    expect(sensorEventsBetween(after, after)).toEqual([]);
  });

  it("reports progress changes", () => {
    const before = run("r1", [["a", "running"]], {
      a: { done: 1, total: 4, unit: "files" },
    });
    const moved = run("r1", [["a", "running"]], {
      a: { done: 2, total: 4, unit: "files" },
    });

    expect(sensorEventsBetween(before, moved)).toEqual([
      {
        event: "plugin",
        phase: "sense",
        name: "a",
        data: { event: "progress", done: 2, total: 4, unit: "files" },
      },
    ]);
  });

  it("a_failed_plugin_event_carries_the_runs_reason_and_diagnosis", () => {
    const diagnosis = { code: "no-coverage", line: "no report" };
    const before = run("r1", [["a", "running"]]);
    const failed = run(
      "r1",
      [["a", "failed"]],
      {},
      {
        a: { reason: "boom", diagnosis },
      },
    );

    expect(sensorEventsBetween(before, failed)).toEqual([
      {
        event: "entry",
        phase: "sense",
        name: "a",
        outcome: "failed",
        reason: "boom",
        diagnosis,
      },
    ]);
  });

  it("a_failed_plugin_never_reads_the_reason_failed_when_the_run_has_one", () => {
    const before = run("r1", [["a", "running"]]);
    const failed = run(
      "r1",
      [["a", "failed"]],
      {},
      {
        a: { reason: "the suite web left no coverage", diagnosis: null },
      },
    );
    const [entry] = sensorEventsBetween(before, failed);

    expect(entry).toMatchObject({
      reason: "the suite web left no coverage",
    });
    expect(entry).not.toHaveProperty("diagnosis");
  });

  it("starts afresh for a different run", () => {
    const before = run("r1", [["a", "finished"]]);
    const after = run("r2", [["a", "running"]]);

    expect(sensorEventsBetween(before, after).map((e) => e.event)).toEqual([
      "phase",
      "start",
    ]);
  });
});
