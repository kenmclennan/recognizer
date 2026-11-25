import { describe, expect, it } from "vitest";
import {
  InvalidEntity,
  PluginRun,
  Run,
  type RunReport,
} from "../../src/index.js";

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
    expect(running.apply({ kind: "running" })).toBe(running);

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

  it("the_run_is_running_once_its_extract_plugin_run_has_ended", () => {
    const planned = begun().apply({
      kind: "extract-planned",
      languages: ["python"],
    });

    expect(planned.state).toBe("checking");

    const ended = planned.apply({
      kind: "plugin-ended",
      name: "python",
      phase: "extract",
      state: "finished",
    });

    expect(ended.state).toBe("running");
  });

  it("a_structure_report_moves_a_checking_run_to_running", () => {
    const structured = begun().apply({
      kind: "structure",
      state: "done",
      files: 2,
    });

    expect(structured.state).toBe("running");
    expect(structured.apply({ kind: "running" })).toBe(structured);
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

  it("a_run_with_describe_holds_describe_then_the_sensors", () => {
    const run = Run.begin({
      id: "run-1",
      startedBy: "cli",
      startedAt: "2026-11-24T10:00:00.000Z",
      scope: { kind: "working-tree" },
      choices: { sensors: ["tally"], describe: true, suites: {} },
    });

    expect(run.view().plugins.map(({ phase, name }) => [phase, name])).toEqual([
      ["describe", "describe"],
      ["sense", "tally"],
    ]);
  });
});

function extracting(languages: string[] = ["python", "typescript"]): Run {
  return Run.begin({
    id: "run-1",
    startedBy: "cli",
    startedAt: "2026-11-24T10:00:00.000Z",
    scope: { kind: "working-tree" },
    choices: { sensors: ["tally"], describe: true, suites: {} },
  })
    .apply({ kind: "running" })
    .apply({ kind: "extract-planned", languages });
}

function describing(total: number): Run {
  return extracting([]).apply({
    kind: "plugin-started",
    name: "describe",
    progress: { done: 0, total, unit: "files" },
    phase: "describe",
  });
}

function item(name: string, ok: boolean): RunReport {
  return {
    kind: "plugin-item",
    name: "describe",
    item: name,
    ok,
    reason: ok ? "" : `${name} broke`,
    phase: "describe",
  };
}

describe("run extract and describe", () => {
  it("extract_planned_inserts_the_languages_at_the_head_in_order", () => {
    expect(
      extracting()
        .view()
        .plugins.map(({ phase, name }) => `${phase}:${name}`),
    ).toEqual([
      "extract:python",
      "extract:typescript",
      "describe:describe",
      "sense:tally",
    ]);
  });

  it("extract_current_inserts_none", () => {
    const run = extracting([])
      .view()
      .plugins.map(({ name }) => name);
    const current = Run.begin({
      id: "run-1",
      startedBy: "cli",
      startedAt: "2026-11-24T10:00:00.000Z",
      scope: { kind: "working-tree" },
      choices: { sensors: ["tally"], describe: false, suites: {} },
    }).apply({ kind: "extract-current" });

    expect(run).toEqual(["describe", "tally"]);
    expect(current.plugins.map(({ name }) => name)).toEqual(["tally"]);
    expect(() => current.apply({ kind: "extract-current" })).toThrow(
      InvalidEntity,
    );
    expect(() =>
      current.apply({ kind: "extract-planned", languages: ["python"] }),
    ).toThrow(InvalidEntity);
  });

  it("extract_planned_is_refused_a_second_time_and_after_a_plugin_started", () => {
    expect(() =>
      extracting().apply({ kind: "extract-planned", languages: ["rust"] }),
    ).toThrow(InvalidEntity);

    const started = Run.begin({
      id: "run-1",
      startedBy: "cli",
      startedAt: "2026-11-24T10:00:00.000Z",
      scope: { kind: "working-tree" },
      choices: { sensors: ["tally"], describe: false, suites: {} },
    }).apply({ kind: "plugin-started", name: "tally", progress: null });

    expect(() =>
      started.apply({ kind: "extract-planned", languages: ["python"] }),
    ).toThrow(InvalidEntity);
  });

  it("a_language_runs_only_after_the_one_before_ended", () => {
    const run = extracting().apply({
      kind: "plugin-started",
      name: "python",
      progress: null,
      phase: "extract",
    });

    expect(() =>
      run.apply({
        kind: "plugin-started",
        name: "typescript",
        progress: null,
        phase: "extract",
      }),
    ).toThrow(InvalidEntity);

    const next = run
      .apply({
        kind: "plugin-ended",
        name: "python",
        state: "finished",
        phase: "extract",
      })
      .apply({
        kind: "plugin-ended",
        name: "typescript",
        state: "failed",
        failure: { reason: "no parser", diagnosis: null },
        phase: "extract",
      });

    expect(next.plugin("python", "extract").state).toBe("finished");
    expect(next.plugin("typescript", "extract").state).toBe("failed");
  });

  it("running_lists_sense_runs_only", () => {
    const run = extracting(["python"]).apply({
      kind: "plugin-started",
      name: "python",
      progress: null,
      phase: "extract",
    });

    expect(run.plugin("python", "extract").state).toBe("running");
    expect(run.running()).toEqual([]);

    const sensing = run
      .apply({
        kind: "plugin-ended",
        name: "python",
        state: "finished",
        phase: "extract",
      })
      .apply({
        kind: "plugin-started",
        name: "describe",
        progress: { done: 0, total: 1, unit: "files" },
        phase: "describe",
      });

    expect(sensing.plugin("describe", "describe").state).toBe("running");
    expect(sensing.running()).toEqual([]);

    const sensed = sensing
      .apply(item("a.py", true))
      .apply({ kind: "plugin-started", name: "tally", progress: null });

    expect(sensed.running()).toEqual(["tally"]);
  });

  it("itemised_counts_the_tally_and_names_the_first_failure", () => {
    const run = describing(5)
      .apply(item("a.py", true))
      .apply(item("b.py", false))
      .apply(item("c.py", false));
    const view = run.plugin("describe", "describe").view();

    expect(view.progress?.done).toBe(3);
    expect(view.tally).toEqual({
      ok: 1,
      failed: 2,
      firstFailure: { item: "b.py", reason: "b.py broke" },
    });
    expect(view.state).toBe("running");
  });

  it("the_describe_run_ends_finished_exactly_when_done_reaches_total", () => {
    const almost = describing(2).apply(item("a.py", true));

    expect(almost.plugin("describe", "describe").state).toBe("running");

    const done = almost.apply(item("b.py", false));

    expect(done.plugin("describe", "describe").state).toBe("finished");
  });

  it("a_describe_run_of_zero_files_ends_at_its_start", () => {
    expect(describing(0).plugin("describe", "describe").state).toBe("finished");
  });

  it("every_file_failed_ends_the_describe_run_failed", () => {
    const run = describing(2)
      .apply(item("a.py", false))
      .apply(item("b.py", false));
    const view = run.plugin("describe", "describe").view();

    expect(view.state).toBe("failed");
    expect(view.failure?.reason).toBe("a.py broke");
  });

  it("describe_halted_ends_the_run_stopped_and_sets_the_halt", () => {
    const halt = {
      cause: "limit" as const,
      reason: "usage",
      described: 1,
      notDescribed: 4,
      threshold: 0,
    };
    const run = describing(5)
      .apply(item("a.py", true))
      .apply({ kind: "describe-halted", halt });

    expect(run.plugin("describe", "describe").state).toBe("stopped");
    expect(run.view().describeHalt).toEqual(halt);
    expect(() => run.apply({ kind: "describe-halted", halt })).toThrow(
      InvalidEntity,
    );
  });

  it("a_confirmation_is_asked_then_answered_describe_or_skip", () => {
    const ask = { modules: 4, model: "m", inputTokens: 10, costUsd: null };
    const asked = extracting([]).apply({ kind: "confirmation-asked", ask });

    expect(asked.view().confirmation).toEqual({ ask, answer: null });
    expect(() => asked.apply({ kind: "confirmation-asked", ask })).toThrow(
      InvalidEntity,
    );
    expect(
      asked.apply({ kind: "confirmation-answered", describe: true }).view()
        .confirmation?.answer,
    ).toBe("describe");
    expect(
      asked.apply({ kind: "confirmation-answered", describe: false }).view()
        .confirmation?.answer,
    ).toBe("skip");
  });

  it("an_answer_with_no_ask_is_refused", () => {
    expect(() =>
      extracting([]).apply({ kind: "confirmation-answered", describe: true }),
    ).toThrow(InvalidEntity);
  });

  it("an_unanswered_ask_is_null_after_the_end_and_an_answered_one_is_kept", () => {
    const ask = { modules: 4, model: "m", inputTokens: 10, costUsd: 1.5 };
    const end: RunReport = {
      kind: "ended",
      end: { state: "stopped", endedAt: null, exit: null },
    };
    const asked = extracting([]).apply({ kind: "confirmation-asked", ask });

    expect(asked.apply(end).view().confirmation).toBeNull();
    expect(
      asked
        .apply({ kind: "confirmation-answered", describe: false })
        .apply(end)
        .view().confirmation,
    ).toEqual({ ask, answer: "skip" });
  });

  it("structure_is_a_run_fact", () => {
    const run = extracting([])
      .apply({ kind: "structure", state: "running", files: null })
      .apply({ kind: "structure", state: "done", files: 12 });

    expect(run.view().structure).toEqual({ state: "done", files: 12 });
    expect(extracting([]).view().structure).toBeNull();
  });

  it("logged_sets_once_ignores_null_and_empty_and_is_refused_on_an_ended_run", () => {
    const run = extracting([]);

    expect(run.apply({ kind: "logged", log: null }).view().log).toBeNull();
    expect(run.apply({ kind: "logged", log: "" }).view().log).toBeNull();

    const logged = run.apply({ kind: "logged", log: "run-1" });

    expect(logged.view().log).toBe("run-1");
    expect(logged.apply({ kind: "logged", log: "run-2" }).view().log).toBe(
      "run-1",
    );
    expect(() =>
      logged.stopped(null).apply({ kind: "logged", log: "run-3" }),
    ).toThrow(InvalidEntity);
  });

  it("logged_ends_a_describe_run_still_running", () => {
    const run = describing(3)
      .apply(item("a.py", true))
      .apply({ kind: "logged", log: "run-1" });

    expect(run.plugin("describe", "describe").state).toBe("finished");
  });
});

describe("run skipped phases", () => {
  it("a_sensor_starting_ends_a_queued_describe_run_stopped", () => {
    const run = extracting([]).apply({
      kind: "plugin-started",
      name: "tally",
      progress: null,
    });

    expect(run.plugin("describe", "describe").state).toBe("stopped");
    expect(run.plugin("tally").state).toBe("running");
  });

  it("answering_skip_ends_a_queued_describe_run_stopped_and_answering_describe_does_not", () => {
    const ask = { modules: 2, model: "m", inputTokens: 1, costUsd: null };
    const asked = extracting([]).apply({ kind: "confirmation-asked", ask });

    expect(
      asked
        .apply({ kind: "confirmation-answered", describe: false })
        .plugin("describe", "describe").state,
    ).toBe("stopped");
    expect(
      asked
        .apply({ kind: "confirmation-answered", describe: true })
        .plugin("describe", "describe").state,
    ).toBe("queued");
  });

  it("an_extract_language_reporting_ends_the_earlier_unreported_language_stopped", () => {
    const run = extracting().apply({
      kind: "plugin-ended",
      name: "typescript",
      state: "finished",
      phase: "extract",
    });

    expect(run.plugin("python", "extract").state).toBe("stopped");
    expect(run.plugin("typescript", "extract").state).toBe("finished");
  });
});
