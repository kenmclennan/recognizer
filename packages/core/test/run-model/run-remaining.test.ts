import { describe, expect, it } from "vitest";
import { Run, type RunStarter } from "../../src/index.js";

function begun(
  sensors: string[],
  planned?: Record<string, number>,
  startedBy: RunStarter = "app",
): Run {
  return Run.begin({
    id: "run-1",
    startedBy,
    startedAt: "2026-11-24T10:00:00.000Z",
    scope: { kind: "working-tree" },
    choices: { sensors, describe: false, suites: {} },
    ...(planned === undefined ? {} : { planned }),
  });
}

function running(run: Run, name: string, estimateMs?: number | null): Run {
  const started = run
    .apply({ kind: "running" })
    .apply({ kind: "plugin-started", name, progress: null });

  return estimateMs === undefined
    ? started
    : started.apply({ kind: "plugin-estimate", name, estimateMs });
}

function effective(run: Run, name: string) {
  return run.view().plugins.find((one) => one.name === name)?.effectiveEstimate;
}

describe("run remaining estimate", () => {
  it("a_queued_plugin_with_history_contributes_its_planned_estimate_before_its_first_stage", () => {
    const run = running(
      begun(["crap", "mutation"], { mutation: 300_000 }),
      "crap",
      40_000,
    );

    expect(effective(run, "mutation")).toEqual({
      ms: 300_000,
      source: "history",
    });
    expect(run.view().remaining).toEqual({ ms: 340_000, silent: [] });
  });

  it("a_started_plugin_that_has_not_reported_keeps_its_history_estimate", () => {
    const run = running(begun(["crap"], { crap: 40_000 }), "crap");

    expect(effective(run, "crap")).toEqual({ ms: 40_000, source: "history" });
    expect(run.view().remaining).toEqual({ ms: 40_000, silent: [] });
  });

  it("a_started_plugin_own_estimate_replaces_its_history_estimate", () => {
    const run = running(begun(["crap"], { crap: 40_000 }), "crap", 600_000);

    expect(effective(run, "crap")).toEqual({ ms: 600_000, source: "reported" });
    expect(run.view().remaining?.ms).toBe(600_000);
  });

  it("a_reported_zero_replaces_its_history_estimate", () => {
    const run = running(begun(["crap"], { crap: 40_000 }), "crap", 0);

    expect(effective(run, "crap")).toEqual({ ms: 0, source: "reported" });
    expect(run.view().remaining).toEqual({ ms: 0, silent: [] });
  });

  it("a_started_plugin_without_history_that_has_not_reported_reads_no_estimate_yet", () => {
    const run = running(begun(["crap"]), "crap");

    expect(effective(run, "crap")).toBeNull();
    expect(run.view().remaining).toEqual({ ms: null, silent: ["crap"] });
  });

  it("a_queued_plugin_without_history_still_reads_no_estimate_yet", () => {
    const run = running(
      begun(["crap", "mutation"], { crap: 40_000 }),
      "crap",
      40_000,
    );

    expect(run.view().remaining).toEqual({ ms: null, silent: ["mutation"] });
  });

  it("a_run_reads_no_estimate_yet_while_a_queued_plugin_has_not_reported", () => {
    const run = running(begun(["crap", "mutation"]), "crap", 40_000);

    expect(effective(run, "crap")).toEqual({ ms: 40_000, source: "reported" });
    expect(effective(run, "mutation")).toBeNull();
    expect(run.view().remaining).toEqual({ ms: null, silent: ["mutation"] });
  });

  it("a_plugin_that_reports_none_reads_no_estimate_yet", () => {
    const run = running(begun(["crap"]), "crap", null);

    expect(run.view().remaining).toEqual({ ms: null, silent: ["crap"] });
  });

  it("a_run_with_some_plugins_silent_lists_exactly_those", () => {
    const run = running(
      begun(["crap", "mutation", "ledger"], { mutation: 5000 }),
      "crap",
      9000,
    );

    expect(effective(run, "crap")?.source).toBe("reported");
    expect(effective(run, "mutation")?.source).toBe("history");
    expect(effective(run, "ledger")).toBeNull();
    expect(run.view().remaining).toEqual({ ms: null, silent: ["ledger"] });
  });

  it("a_run_reads_the_sum_of_every_live_plugins_estimate", () => {
    const run = running(begun(["crap", "mutation"]), "crap", 300_000)
      .apply({ kind: "plugin-ended", name: "crap", state: "finished" })
      .apply({ kind: "plugin-started", name: "mutation", progress: null })
      .apply({
        kind: "plugin-estimate",
        name: "mutation",
        estimateMs: 240_000,
      });
    const both = running(
      begun(["crap", "mutation"], { mutation: 240_000 }),
      "crap",
      300_000,
    );

    expect(both.view().remaining?.silent).toEqual([]);
    expect(both.view().remaining?.ms).toBe(540_000);
    expect(run.view().remaining).toEqual({ ms: 240_000, silent: [] });
  });

  it("an_ended_plugin_has_no_effective_estimate", () => {
    const run = running(
      begun(["crap", "mutation"], { crap: 1000, mutation: 2000 }),
      "crap",
      1000,
    ).apply({ kind: "plugin-ended", name: "crap", state: "finished" });

    expect(effective(run, "crap")).toBeNull();
    expect(run.view().remaining).toEqual({ ms: 2000, silent: [] });
  });

  it("remaining_is_null_for_a_command_line_run_a_checking_run_and_a_run_with_no_live_sensor", () => {
    const cli = running(begun(["crap"], { crap: 1000 }, "cli"), "crap");
    const checking = begun(["crap"], { crap: 1000 });
    const noSensor = Run.begin({
      id: "run-2",
      startedBy: "app",
      startedAt: "2026-11-24T10:00:00.000Z",
      scope: { kind: "working-tree" },
      choices: { sensors: [], describe: false, suites: {} },
    }).apply({ kind: "running" });

    expect(cli.state).toBe("running");
    expect(cli.view().remaining).toBeNull();
    expect(checking.state).toBe("checking");
    expect(checking.view().remaining).toBeNull();
    expect(noSensor.state).toBe("running");
    expect(noSensor.view().remaining).toBeNull();
  });

  it("an_extract_run_carries_no_effective_estimate_even_with_a_reported_estimate", () => {
    const run = begun(["crap"], { crap: 1000 })
      .apply({ kind: "extract-planned", languages: ["python"] })
      .apply({
        kind: "plugin-started",
        name: "python",
        phase: "extract",
        progress: null,
      })
      .apply({
        kind: "plugin-estimate",
        name: "python",
        phase: "extract",
        estimateMs: 7000,
      });
    const extract = run.view().plugins.find((one) => one.phase === "extract");

    expect(extract?.estimateMs).toBe(7000);
    expect(extract?.effectiveEstimate).toBeNull();
    expect(run.view().remaining).toEqual({ ms: 1000, silent: [] });
  });
});
