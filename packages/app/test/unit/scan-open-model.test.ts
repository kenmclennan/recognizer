import { Run, type RunReport } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import {
  type OpenProgress,
  openProgressModel,
} from "../../src/scan-open-model";
import {
  NO_OVERLAY,
  NO_PROGRESS,
  NO_TIMING,
  progressOfRun,
  type RunProgress,
} from "../../src/scan-progress";

function progress(over: Partial<RunProgress> = {}): RunProgress {
  return { ...NO_PROGRESS, ...over };
}

function timing(over: Partial<RunProgress["timing"]>): RunProgress["timing"] {
  return { ...NO_PROGRESS.timing, ...over };
}

function shown(
  scan: RunProgress,
  now: number,
  startedAt = 0,
  stopped = false,
): OpenProgress {
  const model = openProgressModel({
    folder: "recognizer",
    progress: scan,
    startedAt,
    now,
    stopped,
  });

  if (model.kind !== "progress") {
    throw new Error("expected a progress model");
  }

  return model;
}

function running(done: number, total: number, began = 0): RunProgress {
  return progress({
    extract: "run",
    languages: ["python", "rust"],
    sensorProgress: {
      name: "python",
      phase: "extract",
      progress: { done, total, unit: "files" },
    },
    timing: timing({
      extractAt: { python: began },
      extractTotals: { python: total },
    }),
  });
}

describe("the open progress model", () => {
  it("titles the scan with the folder name", () => {
    expect(shown(progress(), 0).title).toBe("Scanning recognizer");
  });

  it("finds the languages before any scanner reports", () => {
    const model = shown(progress({ languages: ["python"] }), 0);

    expect(model.stage).toBe("Finding the languages in this repository");
    expect(model.bar).toEqual({ kind: "indeterminate" });
    expect(model.counts).toBe("");
    expect(model.timeLeft).toBeNull();
  });

  it("moves past finding the languages once the extract plugin run has ended", () => {
    const reports: RunReport[] = [
      { kind: "extract-planned", languages: ["python"] },
      {
        kind: "plugin-started",
        name: "python",
        phase: "extract",
        progress: { done: 0, total: 2, unit: "files" },
      },
      {
        kind: "plugin-ended",
        name: "python",
        phase: "extract",
        state: "finished",
      },
    ];
    const run = reports.reduce(
      (held, report) => held.apply(report),
      Run.begin({
        id: "run-1",
        startedBy: "app",
        startedAt: "2026-11-24T00:00:00.000Z",
        scope: { kind: "working-tree" },
        choices: { sensors: ["crap"], describe: false, suites: {} },
      }),
    );
    const model = shown(progressOfRun(run.view(), NO_TIMING, NO_OVERLAY), 0);

    expect(model.stage).toBe("Finishing the scan");
    expect(model.bar).toEqual({ kind: "determinate", fraction: 1 });
  });

  it("reads the running scanner's language once it reports", () => {
    expect(shown(running(10, 100), 1000).stage).toBe("Reading Python files");
  });

  it("stays indeterminate until the running scanner's total is known", () => {
    const scan = progress({
      languages: ["python"],
      sensorProgress: { name: "python", phase: "extract" },
      timing: timing({ extractAt: { python: 0 } }),
    });

    expect(shown(scan, 1000).bar).toEqual({ kind: "indeterminate" });
  });

  it("gives the fraction mid-way, at the exact bound and for a total of 0", () => {
    expect(shown(running(50, 200), 1000).bar).toEqual({
      kind: "determinate",
      fraction: 0.25,
    });
    expect(shown(running(200, 200), 1000).bar).toEqual({
      kind: "determinate",
      fraction: 1,
    });
    expect(shown(running(0, 0), 1000).bar).toEqual({
      kind: "determinate",
      fraction: 1,
    });
  });

  it("clamps a count past its total", () => {
    expect(shown(running(300, 200), 1000).bar).toEqual({
      kind: "determinate",
      fraction: 1,
    });
  });

  it("counts files with thousands separators", () => {
    expect(shown(running(1240, 3812), 1000).counts).toBe(
      "1,240 of 3,812 files",
    );
  });

  it("shows no time left at 4.9 seconds, with nothing done, then does at exactly 5", () => {
    expect(shown(running(100, 1000), 4900).timeLeft).toBeNull();
    expect(shown(running(0, 1000), 6000).timeLeft).toBeNull();
    expect(shown(running(100, 1000), 5000).timeLeft).toBe(
      "under a minute left",
    );
  });

  it("words time left from the running scanner's own rate", () => {
    const model = shown(running(100, 4000), 10_000);

    expect(model.counts).not.toBe("");
    expect(model.timeLeft).toBe("about 7 min left");
  });

  it("carries only the running scanner's time, never a whole-scan figure", () => {
    const model = shown(running(1000, 1100), 10_000);

    expect(model.counts).toBe("1,000 of 1,100 files");
    expect(model.timeLeft).toBe("under a minute left");
  });

  it("measures the running scanner from its own first event", () => {
    const model = shown(running(100, 1000, 8000), 12_000, 0);

    expect(model.timeLeft).toBeNull();
  });

  it("counts only the awake time handed in, across a large gap", () => {
    const scan = running(100, 1000, 1000);

    expect(shown(scan, 6000, 1000).elapsed).toBe("0:05");
    expect(shown(scan, 6000, 1000).timeLeft).toBe("under a minute left");
    expect(shown(scan, 4_000_000, 1000).elapsed).toBe("66:39");
  });

  it("gives no rows when the scan lists no languages", () => {
    expect(shown(progress(), 0).rows).toEqual([]);
  });

  it("has a row only for each listed language", () => {
    const rows = shown(progress({ languages: ["python", "rust"] }), 0).rows.map(
      (row) => row.name,
    );

    expect(rows).toEqual(["Python", "Rust"]);
  });

  it("rows move through waiting, running, done and failed", () => {
    const scan = progress({
      extract: "run",
      languages: ["typescript", "python", "rust", "kotlin"],
      extractEntries: [
        { name: "typescript", outcome: "ok", reason: null, diagnosis: null },
        { name: "python", outcome: "failed", reason: "x", diagnosis: null },
      ],
      sensorProgress: {
        name: "rust",
        phase: "extract",
        progress: { done: 90, total: 214, unit: "files" },
      },
      timing: timing({
        extractAt: { typescript: 1000, python: 7000, rust: 8000 },
        extractDoneAt: { typescript: 7000, python: 8000 },
        extractTotals: { typescript: 812, python: 3812, rust: 214 },
      }),
    });
    const rows = shown(scan, 9000).rows;

    expect(rows.map((row) => [row.name, row.state, row.text])).toEqual([
      ["Typescript", "done", "812 files · 6s"],
      ["Python", "failed", "failed"],
      ["Rust", "running", "90 / 214"],
      ["Kotlin", "waiting", "waiting"],
    ]);
  });

  it("links a failed row's log only once the log id is known", () => {
    const failed = progress({
      languages: ["python"],
      extractEntries: [
        { name: "python", outcome: "failed", reason: "x", diagnosis: null },
      ],
    });

    expect(shown(failed, 0).rows[0]?.logLink).toBe(false);
    expect(shown({ ...failed, log: "abc" }, 0).rows[0]?.logLink).toBe(true);
  });

  it("keeps a waiting row without a count when a total is not yet known", () => {
    const scan = progress({
      languages: ["python", "rust"],
      sensorProgress: { name: "python", phase: "extract" },
      timing: timing({
        extractAt: { python: 0 },
        extractTotals: { python: 5 },
      }),
    });
    const rows = shown(scan, 1000).rows;

    expect(rows[1]).toMatchObject({ state: "waiting", text: "waiting" });
    expect(rows[0]).toMatchObject({ state: "running", text: "0 / 5" });
  });

  it("shows a done row's seconds without a count when no total was reported", () => {
    const scan = progress({
      languages: ["python"],
      extractEntries: [
        { name: "python", outcome: "ok", reason: null, diagnosis: null },
      ],
      timing: timing({
        extractAt: { python: 0 },
        extractDoneAt: { python: 4000 },
      }),
    });

    expect(shown(scan, 5000).rows[0]?.text).toBe("4s");
  });

  it("counts elapsed from the start, as m:ss", () => {
    expect(shown(progress(), 125_000, 5000).elapsed).toBe("2:00");
  });

  it("gives the stopped model after Stop", () => {
    expect(
      openProgressModel({
        folder: "recognizer",
        progress: progress(),
        startedAt: 0,
        now: 0,
        stopped: true,
      }),
    ).toEqual({
      kind: "stopped",
      title: "Scan stopped",
      message: "Nothing is shown until a scan of this repository completes",
      again: "Scan again",
    });
  });
});
