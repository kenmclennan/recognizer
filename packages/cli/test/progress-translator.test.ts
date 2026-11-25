import type { RunReport } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { reportOfLine } from "../src/adapters/filesystem/progress-translator.js";

const SENSORS = new Set(["tally"]);

function report(value: unknown): RunReport | null {
  return reportOfLine(JSON.stringify(value), SENSORS);
}

const UNREADABLE = { kind: "unreadable" };

describe("progress translator extract lines", () => {
  it("phase_extract_run_with_languages_plans_them", () => {
    expect(
      report({
        event: "phase",
        phase: "extract",
        state: "run",
        commit: null,
        reason: "forced",
        languages: ["python", "rust"],
      }),
    ).toEqual({ kind: "extract-planned", languages: ["python", "rust"] });
  });

  it("phase_extract_run_without_languages_and_current_are_extract_current", () => {
    expect(
      report({
        event: "phase",
        phase: "extract",
        state: "run",
        commit: null,
        reason: "forced",
      }),
    ).toEqual({ kind: "extract-current" });
    expect(
      report({
        event: "phase",
        phase: "extract",
        state: "current",
        commit: "a",
      }),
    ).toEqual({ kind: "extract-current" });
  });

  it("phase_extract_with_malformed_languages_is_unreadable", () => {
    expect(
      report({
        event: "phase",
        phase: "extract",
        state: "run",
        languages: ["python", 3],
      }),
    ).toEqual(UNREADABLE);
  });

  it("an_extract_plugin_start_and_progress_report_the_language", () => {
    expect(
      report({
        event: "plugin",
        phase: "extract",
        name: "python",
        data: { event: "start", total: 40, unit: "files" },
      }),
    ).toEqual({
      kind: "plugin-started",
      name: "python",
      progress: { done: 0, total: 40, unit: "files" },
      phase: "extract",
    });
    expect(
      report({
        event: "plugin",
        phase: "extract",
        name: "python",
        data: { event: "progress", done: 12, total: 40, unit: "files" },
      }),
    ).toEqual({
      kind: "plugin-progress",
      name: "python",
      progress: { done: 12, total: 40, unit: "files" },
      phase: "extract",
    });
  });

  it("an_extract_plugin_stage_and_estimate_are_reported", () => {
    expect(
      report({
        event: "plugin",
        phase: "extract",
        name: "python",
        data: { event: "stage", name: "parse", index: 1, of: 2 },
      }),
    ).toEqual({
      kind: "plugin-stage",
      name: "python",
      stage: { name: "parse", index: 1, of: 2 },
      phase: "extract",
    });
    expect(
      report({
        event: "plugin",
        phase: "extract",
        name: "python",
        data: { event: "estimate", remaining_ms: 5 },
      }),
    ).toEqual({
      kind: "plugin-estimate",
      name: "python",
      estimateMs: 5,
      phase: "extract",
    });
  });

  it("an_extract_plugin_line_with_a_bad_start_is_unreadable", () => {
    expect(
      report({
        event: "plugin",
        phase: "extract",
        name: "python",
        data: { event: "start", total: "x", unit: "files" },
      }),
    ).toEqual(UNREADABLE);
  });

  it("an_extract_entry_ends_the_language", () => {
    expect(
      report({
        event: "entry",
        phase: "extract",
        name: "python",
        outcome: "ok",
        modules: 3,
        edges: 4,
      }),
    ).toEqual({
      kind: "plugin-ended",
      name: "python",
      state: "finished",
      phase: "extract",
    });
    expect(
      report({
        event: "entry",
        phase: "extract",
        name: "rust",
        outcome: "stopped",
      }),
    ).toEqual({
      kind: "plugin-ended",
      name: "rust",
      state: "stopped",
      phase: "extract",
    });
  });

  it("an_extract_entry_that_fails_carries_reason_and_diagnosis", () => {
    const diagnosis = { code: "missing", text: "no parser", fix: "install it" };

    expect(
      report({
        event: "entry",
        phase: "extract",
        name: "python",
        outcome: "failed",
        reason: "crashed",
        diagnosis,
      }),
    ).toEqual({
      kind: "plugin-ended",
      name: "python",
      state: "failed",
      failure: { reason: "crashed", diagnosis },
      phase: "extract",
    });
    expect(
      report({
        event: "entry",
        phase: "extract",
        name: "python",
        outcome: "failed",
      }),
    ).toMatchObject({ failure: { reason: "no reason was recorded" } });
  });

  it("an_extract_entry_with_an_unknown_outcome_is_unreadable", () => {
    expect(
      report({
        event: "entry",
        phase: "extract",
        name: "python",
        outcome: "?",
      }),
    ).toEqual(UNREADABLE);
  });
});

describe("progress translator describe lines", () => {
  it("phase_describe_starts_the_describe_run_with_its_total", () => {
    expect(report({ event: "phase", phase: "describe", total: 7 })).toEqual({
      kind: "plugin-started",
      name: "describe",
      progress: { done: 0, total: 7, unit: "files" },
      phase: "describe",
    });
    expect(report({ event: "phase", phase: "describe", total: 0 })).toEqual({
      kind: "plugin-started",
      name: "describe",
      progress: { done: 0, total: 0, unit: "files" },
      phase: "describe",
    });
    expect(report({ event: "phase", phase: "describe" })).toEqual(UNREADABLE);
  });

  it("a_describe_entry_is_one_item", () => {
    expect(
      report({
        event: "entry",
        phase: "describe",
        name: "a.py",
        outcome: "ok",
      }),
    ).toEqual({
      kind: "plugin-item",
      name: "describe",
      item: "a.py",
      ok: true,
      reason: "no reason was recorded",
      phase: "describe",
    });
  });

  it("a_describe_entry_that_fails_carries_its_reason", () => {
    expect(
      report({
        event: "entry",
        phase: "describe",
        name: "a.py",
        outcome: "failed",
        reason: "timed out",
      }),
    ).toEqual({
      kind: "plugin-item",
      name: "describe",
      item: "a.py",
      ok: false,
      reason: "timed out",
      phase: "describe",
    });
  });

  it("a_describe_stage_is_reported_on_the_describe_run", () => {
    expect(
      report({
        event: "plugin",
        phase: "describe",
        name: "claude",
        data: { event: "stage", name: "ask", index: 1, of: 1 },
      }),
    ).toEqual({
      kind: "plugin-stage",
      name: "describe",
      stage: { name: "ask", index: 1, of: 1 },
      phase: "describe",
    });
  });

  it("a_describe_plugin_progress_line_is_not_a_report", () => {
    expect(
      report({
        event: "plugin",
        phase: "describe",
        name: "claude",
        data: { event: "progress", done: 1, total: 2, unit: "files" },
      }),
    ).toBeNull();
  });
});

describe("progress translator run facts", () => {
  it("confirm_carries_the_projection_with_a_null_and_a_numeric_cost", () => {
    const line = {
      event: "confirm",
      phase: "describe",
      modules: 4,
      model: "m",
      input_tokens: 900,
    };

    expect(report({ ...line, cost_usd: null })).toEqual({
      kind: "confirmation-asked",
      ask: { modules: 4, model: "m", inputTokens: 900, costUsd: null },
    });
    expect(report({ ...line, cost_usd: 1.25 })).toEqual({
      kind: "confirmation-asked",
      ask: { modules: 4, model: "m", inputTokens: 900, costUsd: 1.25 },
    });
  });

  it("a_confirm_with_a_wrong_typed_field_is_unreadable", () => {
    expect(
      report({
        event: "confirm",
        phase: "describe",
        modules: -1,
        model: "m",
        input_tokens: 1,
        cost_usd: null,
      }),
    ).toEqual(UNREADABLE);
    expect(
      report({
        event: "confirm",
        phase: "describe",
        modules: 1,
        model: "m",
        input_tokens: 1,
        cost_usd: "free",
      }),
    ).toEqual(UNREADABLE);
  });

  it("answered_reports_the_answer", () => {
    expect(
      report({ event: "answered", phase: "describe", describe: false }),
    ).toEqual({ kind: "confirmation-answered", describe: false });
  });

  it("stopped_reports_each_cause", () => {
    for (const cause of ["limit", "failures"]) {
      expect(
        report({
          event: "stopped",
          phase: "describe",
          cause,
          reason: "why",
          described: 2,
          not_described: 3,
          threshold: 5,
        }),
      ).toEqual({
        kind: "describe-halted",
        halt: {
          cause,
          reason: "why",
          described: 2,
          notDescribed: 3,
          threshold: 5,
        },
      });
    }
  });

  it("a_stopped_with_a_wrong_typed_field_is_unreadable", () => {
    expect(
      report({
        event: "stopped",
        phase: "describe",
        cause: "other",
        described: 1,
        not_described: 1,
      }),
    ).toEqual(UNREADABLE);
    expect(
      report({
        event: "stopped",
        phase: "describe",
        cause: "limit",
        described: "1",
        not_described: 1,
      }),
    ).toEqual(UNREADABLE);
  });

  it("structure_run_and_done_are_reported", () => {
    expect(report({ event: "structure", state: "run" })).toEqual({
      kind: "structure",
      state: "running",
      files: null,
    });
    expect(report({ event: "structure", state: "done", files: 9 })).toEqual({
      kind: "structure",
      state: "done",
      files: 9,
    });
    expect(report({ event: "structure", state: "bogus" })).toEqual(UNREADABLE);
  });

  it("summary_reports_the_log_with_and_without_one", () => {
    expect(report({ event: "summary", exit: 0, log: "run-1" })).toEqual({
      kind: "logged",
      log: "run-1",
    });
    expect(report({ event: "summary", exit: 0, log: null })).toEqual({
      kind: "logged",
      log: null,
    });
    expect(report({ event: "summary", exit: 0 })).toEqual({
      kind: "logged",
      log: null,
    });
  });

  it("a_line_that_is_not_json_is_unreadable_and_an_unknown_event_is_dropped", () => {
    expect(reportOfLine("not json", SENSORS)).toEqual(UNREADABLE);
    expect(report({ event: "preflight", state: "ok" })).toBeNull();
  });
});
