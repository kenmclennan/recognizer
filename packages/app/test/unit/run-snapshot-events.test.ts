import type {
  PluginFailure,
  PluginPhase,
  PluginRunState,
  PluginTally,
  RunView,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { runChangesBetween } from "../../src/run-snapshot-events";

type Spec = [string, PluginRunState, PluginPhase?];

function run(
  id: string,
  plugins: Spec[],
  more: {
    progress?: Record<string, { done: number; total: number; unit: string }>;
    failures?: Record<string, PluginFailure>;
    tally?: Record<string, PluginTally>;
    halted?: boolean;
  } = {},
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
    plugins: plugins.map(([name, state, phase = "sense"]) => ({
      name,
      phase,
      state,
      progress: more.progress?.[name] ?? null,
      stage: null,
      estimateMs: null,
      effectiveEstimate: null,
      failure: more.failures?.[name] ?? null,
      tally: more.tally?.[name] ?? null,
      durationMs: null,
    })),
    remaining: null,
    confirmation: null,
    describeHalt: more.halted
      ? {
          cause: "limit",
          reason: "usage",
          described: 1,
          notDescribed: 1,
          threshold: 0,
        }
      : null,
    structure: null,
    log: null,
  };
}

describe("runChangesBetween", () => {
  it("names a start when the first sensor begins", () => {
    const before = run("r1", [["a", "queued"]]);
    const after = run("r1", [["a", "running"]]);

    expect(runChangesBetween(before, after)).toEqual([
      { kind: "sense-started", name: "a" },
    ]);
  });

  it("reports an end once when a sensor ends and nothing when nothing changed", () => {
    const before = run("r1", [
      ["a", "running"],
      ["b", "queued"],
    ]);
    const after = run("r1", [
      ["a", "finished"],
      ["b", "running"],
    ]);

    expect(runChangesBetween(before, after).map((one) => one.kind)).toEqual([
      "sense-ended",
      "sense-started",
    ]);
    expect(runChangesBetween(after, after)).toEqual([]);
  });

  it("reports progress changes", () => {
    const before = run("r1", [["a", "running"]], {
      progress: { a: { done: 1, total: 4, unit: "files" } },
    });
    const moved = run("r1", [["a", "running"]], {
      progress: { a: { done: 2, total: 4, unit: "files" } },
    });

    expect(runChangesBetween(before, moved)).toEqual([]);
  });

  it("a_failed_plugin_event_carries_the_runs_reason_and_diagnosis", () => {
    const diagnosis = { code: "no-coverage", line: "no report" };
    const before = run("r1", [["a", "running"]]);
    const failed = run("r1", [["a", "failed"]], {
      failures: { a: { reason: "boom", diagnosis } },
    });

    expect(runChangesBetween(before, failed)).toEqual([
      {
        kind: "sense-ended",
        name: "a",
        outcome: "failed",
        reason: "boom",
        diagnosis,
      },
    ]);
  });

  it("a_failed_plugin_never_reads_the_reason_failed_when_the_run_has_one", () => {
    const before = run("r1", [["a", "running"]]);
    const failed = run("r1", [["a", "failed"]], {
      failures: {
        a: { reason: "the suite web left no coverage", diagnosis: null },
      },
    });

    expect(runChangesBetween(before, failed)[0]).toMatchObject({
      reason: "the suite web left no coverage",
    });
  });

  it("starts afresh for a different run", () => {
    const before = run("r1", [["a", "finished"]]);
    const after = run("r2", [["a", "running"]]);

    expect(runChangesBetween(before, after).map((one) => one.kind)).toEqual([
      "sense-started",
    ]);
  });

  it("reports an extract language that failed with its reason", () => {
    const before = run("r1", [["python", "running", "extract"]]);
    const after = run("r1", [["python", "failed", "extract"]], {
      failures: { python: { reason: "no cargo", diagnosis: null } },
    });

    expect(runChangesBetween(before, after)).toEqual([
      {
        kind: "extract-ended",
        name: "python",
        outcome: "failed",
        reason: "no cargo",
      },
    ]);
  });

  it("an extract plugin and a sensor of one name are told apart by phase", () => {
    const before = run("r1", [
      ["tally", "running", "extract"],
      ["tally", "queued"],
    ]);
    const after = run("r1", [
      ["tally", "finished", "extract"],
      ["tally", "running"],
    ]);

    expect(runChangesBetween(before, after).map((one) => one.kind)).toEqual([
      "extract-ended",
      "sense-started",
    ]);
  });

  it("describe starts, counts each new file and ends once", () => {
    const queued = run("r1", [["describe", "queued", "describe"]]);
    const started = run("r1", [["describe", "running", "describe"]], {
      progress: { describe: { done: 0, total: 3, unit: "files" } },
    });
    const counted = run("r1", [["describe", "running", "describe"]], {
      progress: { describe: { done: 2, total: 3, unit: "files" } },
    });
    const done = run("r1", [["describe", "finished", "describe"]], {
      progress: { describe: { done: 3, total: 3, unit: "files" } },
    });

    expect(runChangesBetween(queued, started)).toEqual([
      { kind: "describe-started", total: 3 },
    ]);
    expect(runChangesBetween(started, counted)).toEqual([
      { kind: "described" },
      { kind: "described" },
    ]);
    expect(runChangesBetween(counted, done)).toEqual([
      { kind: "described" },
      { kind: "describe-ended", outcome: "ok", reason: "failed" },
    ]);
  });

  it("a describe run of zero files starts and ends in one step", () => {
    const after = run("r1", [["describe", "finished", "describe"]], {
      progress: { describe: { done: 0, total: 0, unit: "files" } },
    });

    expect(runChangesBetween(null, after)).toEqual([
      { kind: "describe-started", total: 0 },
      { kind: "describe-ended", outcome: "ok", reason: "failed" },
    ]);
  });

  it("a halted describe run that fully failed ends failed and one that did not ends ok", () => {
    const before = run("r1", [["describe", "running", "describe"]]);
    const everyFailed = run("r1", [["describe", "stopped", "describe"]], {
      halted: true,
      progress: { describe: { done: 2, total: 5, unit: "files" } },
      tally: {
        describe: {
          ok: 0,
          failed: 2,
          firstFailure: { item: "a.py", reason: "timed out" },
        },
      },
    });
    const mixed = run("r1", [["describe", "stopped", "describe"]], {
      halted: true,
      progress: { describe: { done: 2, total: 5, unit: "files" } },
      tally: { describe: { ok: 1, failed: 1, firstFailure: null } },
    });

    expect(
      runChangesBetween(before, everyFailed).filter(
        (one) => one.kind === "describe-ended",
      ),
    ).toEqual([
      { kind: "describe-ended", outcome: "failed", reason: "timed out" },
    ]);
    expect(
      runChangesBetween(before, mixed).filter(
        (one) => one.kind === "describe-ended",
      ),
    ).toMatchObject([{ outcome: "ok" }]);
  });

  it("a describe run stopped by the run ending reads stopped", () => {
    const before = run("r1", [["describe", "running", "describe"]]);
    const after = run("r1", [["describe", "stopped", "describe"]]);

    expect(
      runChangesBetween(before, after).filter(
        (one) => one.kind === "describe-ended",
      ),
    ).toMatchObject([{ outcome: "stopped" }]);
  });
});
