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
});
