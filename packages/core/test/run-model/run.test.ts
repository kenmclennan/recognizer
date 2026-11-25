import { describe, expect, it } from "vitest";
import { InvalidEntity, PluginRun, Run } from "../../src/index.js";

function begun(sensors: string[] = ["tally", "margin"]): Run {
  return Run.begin({
    id: "run-1",
    startedBy: "cli",
    startedAt: "2026-11-24T10:00:00.000Z",
    scope: { kind: "working-tree" },
    choices: { sensors, describe: false, suites: {} },
  });
}

const PROGRESS = { done: 1, total: 4, unit: "files" };

describe("run", () => {
  it("a_run_only_moves_forward", () => {
    const running = begun().apply({ kind: "running" });

    expect(running.state).toBe("running");
    expect(() => running.apply({ kind: "running" })).toThrow(InvalidEntity);

    const progressing = running
      .apply({ kind: "plugin-started", name: "tally", progress: null })
      .apply({ kind: "plugin-progress", name: "tally", progress: PROGRESS });

    expect(progressing.plugin("tally").progress).toEqual(PROGRESS);
    expect(() =>
      begun().apply({
        kind: "plugin-progress",
        name: "tally",
        progress: PROGRESS,
      }),
    ).toThrow(InvalidEntity);
  });

  it("an_ended_run_refuses_a_report", () => {
    const ended = begun().apply({
      kind: "ended",
      end: { state: "finished", endedAt: "2026-11-24T10:05:00.000Z", exit: 0 },
    });

    expect(ended.active).toBe(false);
    expect(ended.plugins.every(({ ended: over }) => over)).toBe(true);
    expect(() => ended.apply({ kind: "running" })).toThrow(InvalidEntity);
    expect(() => ended.stopped(null)).toThrow(InvalidEntity);
  });

  it("a_plugin_runs_only_after_the_one_before_it_ended", () => {
    const run = begun().apply({ kind: "running" });

    expect(() =>
      run.apply({ kind: "plugin-started", name: "margin", progress: null }),
    ).toThrow(InvalidEntity);

    const next = run
      .apply({ kind: "plugin-started", name: "tally", progress: null })
      .apply({ kind: "plugin-ended", name: "tally", state: "finished" })
      .apply({ kind: "plugin-started", name: "margin", progress: null });

    expect(next.plugin("margin").state).toBe("running");

    expect(
      () =>
        new Run({
          id: "run-1",
          startedBy: "cli",
          startedAt: "2026-11-24T10:00:00.000Z",
          scope: { kind: "working-tree" },
          choices: {
            sensors: ["tally", "margin"],
            describe: false,
            suites: {},
          },
          state: "running",
          endedAt: null,
          exit: null,
          plugins: [
            PluginRun.queued("tally"),
            PluginRun.of("margin", "running", null),
          ],
        }),
    ).toThrow(InvalidEntity);
  });

  it("a_plugin_end_is_set_once", () => {
    const run = begun(["tally"])
      .apply({ kind: "running" })
      .apply({ kind: "plugin-started", name: "tally", progress: null })
      .apply({ kind: "plugin-ended", name: "tally", state: "finished" });

    expect(run.plugin("tally").state).toBe("finished");
    expect(() =>
      run.apply({ kind: "plugin-ended", name: "tally", state: "failed" }),
    ).toThrow(InvalidEntity);
    expect(() =>
      PluginRun.queued("tally").end("finished").end("failed"),
    ).toThrow(InvalidEntity);
  });

  it("a_commit_scoped_run_is_accepted", () => {
    const run = Run.begin({
      id: "run-2",
      startedBy: "app",
      startedAt: "2026-11-24T10:00:00.000Z",
      scope: { kind: "commit", commit: "abc123" },
      choices: { sensors: ["tally"], describe: false, suites: {} },
    });

    expect(run.view().scope).toEqual({ kind: "commit", commit: "abc123" });
    expect(() =>
      Run.begin({
        id: "run-3",
        startedBy: "app",
        startedAt: "2026-11-24T10:00:00.000Z",
        scope: { kind: "commit", commit: "" },
        choices: { sensors: [], describe: false, suites: {} },
      }),
    ).toThrow(InvalidEntity);
  });

  it("a_stage_is_kept_until_the_next_stage", () => {
    const running = begun().apply({ kind: "running" }).apply({
      kind: "plugin-started",
      name: "tally",
      progress: null,
    });
    const first = running.apply({
      kind: "plugin-stage",
      name: "tally",
      stage: { name: "Coverage run", index: 1, of: 3 },
    });
    const progressed = first.apply({
      kind: "plugin-progress",
      name: "tally",
      progress: PROGRESS,
    });
    const second = progressed.apply({
      kind: "plugin-stage",
      name: "tally",
      stage: { name: "Measuring", index: 2, of: 3 },
    });

    expect(first.plugin("tally").stage).toEqual({
      name: "Coverage run",
      index: 1,
      of: 3,
    });
    expect(progressed.plugin("tally").stage?.index).toBe(1);
    expect(second.plugin("tally").stage?.index).toBe(2);
  });

  it("a_stage_past_its_total_is_refused", () => {
    const running = begun().apply({ kind: "running" }).apply({
      kind: "plugin-started",
      name: "tally",
      progress: null,
    });

    for (const [index, of] of [
      [4, 3],
      [0, 3],
    ]) {
      expect(() =>
        running.apply({
          kind: "plugin-stage",
          name: "tally",
          stage: { name: "x", index: index as number, of: of as number },
        }),
      ).toThrow(InvalidEntity);
    }
  });

  it("an_estimate_replaces_the_last_and_none_clears_it", () => {
    const running = begun().apply({ kind: "running" }).apply({
      kind: "plugin-started",
      name: "tally",
      progress: null,
    });

    expect(running.plugin("tally").view().estimateMs).toBeNull();
    expect(running.plugin("tally").view().stage).toBeNull();

    const first = running.apply({
      kind: "plugin-estimate",
      name: "tally",
      estimateMs: 5000,
    });
    const second = first.apply({
      kind: "plugin-estimate",
      name: "tally",
      estimateMs: 3000,
    });
    const cleared = second.apply({
      kind: "plugin-estimate",
      name: "tally",
      estimateMs: null,
    });

    expect(first.plugin("tally").estimateMs).toBe(5000);
    expect(second.plugin("tally").estimateMs).toBe(3000);
    expect(cleared.plugin("tally").estimateMs).toBeNull();
    expect(() =>
      running.apply({ kind: "plugin-estimate", name: "tally", estimateMs: -1 }),
    ).toThrow(InvalidEntity);
    expect(() =>
      running.apply({
        kind: "plugin-estimate",
        name: "tally",
        estimateMs: 1.5,
      }),
    ).toThrow(InvalidEntity);
  });

  it("a_plugin_end_clears_the_estimate_and_keeps_the_stage", () => {
    const ended = begun()
      .apply({ kind: "running" })
      .apply({ kind: "plugin-started", name: "tally", progress: null })
      .apply({
        kind: "plugin-stage",
        name: "tally",
        stage: { name: "Coverage run", index: 2, of: 3 },
      })
      .apply({ kind: "plugin-progress", name: "tally", progress: PROGRESS })
      .apply({ kind: "plugin-estimate", name: "tally", estimateMs: 9000 })
      .apply({ kind: "plugin-ended", name: "tally", state: "finished" });

    expect(ended.plugin("tally").estimateMs).toBeNull();
    expect(ended.plugin("tally").stage?.index).toBe(2);
    expect(ended.plugin("tally").progress).toEqual(PROGRESS);
  });

  it("a_failed_plugin_carries_its_failure", () => {
    const failure = {
      reason: "the tests did not run",
      diagnosis: { code: "no-tests", line: "no tests ran" },
    };
    const running = begun()
      .apply({ kind: "running" })
      .apply({ kind: "plugin-started", name: "tally", progress: null });
    const failed = running.apply({
      kind: "plugin-ended",
      name: "tally",
      state: "failed",
      failure,
    });

    expect(failed.plugin("tally").view().failure).toEqual(failure);
    expect(() =>
      running.apply({ kind: "plugin-ended", name: "tally", state: "failed" }),
    ).toThrow(InvalidEntity);
  });

  it("a_failure_on_a_stopped_plugin_is_refused", () => {
    const running = begun()
      .apply({ kind: "running" })
      .apply({ kind: "plugin-started", name: "tally", progress: null });

    expect(() =>
      running.apply({
        kind: "plugin-ended",
        name: "tally",
        state: "stopped",
        failure: { reason: "x", diagnosis: null },
      }),
    ).toThrow(InvalidEntity);
  });

  it("a_queued_plugin_refuses_a_stage_and_an_estimate", () => {
    const queued = begun().apply({ kind: "running" });

    expect(() =>
      queued.apply({
        kind: "plugin-stage",
        name: "tally",
        stage: { name: "x", index: 1, of: 1 },
      }),
    ).toThrow(InvalidEntity);
    expect(() =>
      queued.apply({ kind: "plugin-estimate", name: "tally", estimateMs: 1 }),
    ).toThrow(InvalidEntity);
  });

  it("an_ended_run_carries_its_gaps_failure_and_ran", () => {
    const gaps = [{ id: "g", line: "a gap", needs: ["a thing"] }];
    const failure = {
      sensor: "tally",
      suite: null,
      code: null,
      reason: "it broke",
    };
    const ended = begun().apply({
      kind: "ended",
      end: {
        state: "failed",
        endedAt: "2026-11-24T10:05:00.000Z",
        exit: 1,
        gaps,
        failure,
        ran: ["sense"],
      },
    });

    expect(ended.view().gaps).toEqual(gaps);
    expect(ended.view().failure).toEqual(failure);
    expect(ended.view().ran).toEqual(["sense"]);
    expect(begun().view().gaps).toEqual([]);
    expect(begun().view().failure).toBeNull();
    expect(begun().view().ran).toBeNull();
  });
});
