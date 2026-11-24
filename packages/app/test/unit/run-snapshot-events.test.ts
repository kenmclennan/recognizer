import type { PluginRunState, RunView } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { sensorEventsBetween } from "../../src/run-snapshot-events";

function run(
  id: string,
  plugins: [string, PluginRunState][],
  progress: Record<string, { done: number; total: number; unit: string }> = {},
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
    plugins: plugins.map(([name, state]) => ({
      name,
      state,
      progress: progress[name] ?? null,
      stage: null,
      estimateMs: null,
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

  it("carries the failure detail it is handed and reports progress changes", () => {
    const before = run("r1", [["a", "running"]], {
      a: { done: 1, total: 4, unit: "files" },
    });
    const moved = run("r1", [["a", "running"]], {
      a: { done: 2, total: 4, unit: "files" },
    });
    const failed = run("r1", [["a", "failed"]]);

    expect(sensorEventsBetween(before, moved)).toEqual([
      {
        event: "plugin",
        phase: "sense",
        name: "a",
        data: { event: "progress", done: 2, total: 4, unit: "files" },
      },
    ]);
    expect(
      sensorEventsBetween(moved, failed, () => ({ reason: "boom" })),
    ).toEqual([
      {
        event: "entry",
        phase: "sense",
        name: "a",
        outcome: "failed",
        reason: "boom",
      },
    ]);
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
