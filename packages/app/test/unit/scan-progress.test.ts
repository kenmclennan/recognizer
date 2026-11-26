import { Run, type RunReport } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import {
  describeAskText,
  NO_OVERLAY,
  NO_PROGRESS,
  progressOfRun,
  type RunProgress,
  scanningText,
  showTarget,
  tokensText,
} from "../../src/scan-progress";

function of(
  reports: RunReport[],
  more: {
    sensors?: string[];
    describe?: boolean;
    overlay?: Partial<typeof NO_OVERLAY>;
  } = {},
): RunProgress {
  const run = reports.reduce(
    (held, report) => held.apply(report),
    Run.begin({
      id: "run-1",
      startedBy: "cli",
      startedAt: "2026-11-24T00:00:00.000Z",
      scope: { kind: "working-tree" },
      choices: {
        sensors: more.sensors ?? ["crap", "duplication"],
        describe: more.describe ?? true,
        suites: {},
      },
    }).apply({ kind: "running" }),
  );

  return progressOfRun(run.view(), {
    ...NO_OVERLAY,
    ...more.overlay,
  });
}

const extractCurrent: RunReport = { kind: "extract-current" };
const planned = (...languages: string[]): RunReport => ({
  kind: "extract-planned",
  languages,
});
const describing = (total: number): RunReport => ({
  kind: "plugin-started",
  name: "describe",
  progress: { done: 0, total, unit: "files" },
  phase: "describe",
});
const item = (name: string, reason?: string): RunReport => ({
  kind: "plugin-item",
  name: "describe",
  item: name,
  ok: reason === undefined,
  reason: reason ?? "",
  phase: "describe",
});
const sensed = (name: string): RunReport => ({
  kind: "plugin-started",
  name,
  progress: null,
});
const sensorEnded = (name: string, reason?: string): RunReport =>
  reason === undefined
    ? { kind: "plugin-ended", name, state: "finished" }
    : {
        kind: "plugin-ended",
        name,
        state: "failed",
        failure: { reason, diagnosis: null },
      };
const extractEnded = (name: string, reason?: string): RunReport =>
  reason === undefined
    ? { kind: "plugin-ended", name, state: "finished", phase: "extract" }
    : {
        kind: "plugin-ended",
        name,
        state: "failed",
        failure: { reason, diagnosis: null },
        phase: "extract",
      };
const logged: RunReport = { kind: "logged", log: "run-1" };

describe("progressOfRun", () => {
  it("reads nothing from no run", () => {
    expect(progressOfRun(null)).toEqual(NO_PROGRESS);
  });

  it("reads the languages, the extract entries and the describe counts from the plugin runs", () => {
    const state = of([
      planned("python", "rust"),
      {
        kind: "plugin-started",
        name: "python",
        progress: null,
        phase: "extract",
      },
      extractEnded("python"),
      extractEnded("rust", "no cargo"),
      describing(3),
      item("a.py"),
      item("b.py", "timed out"),
    ]);

    expect(state.languages).toEqual(["python", "rust"]);
    expect(state.extractEntries).toEqual([
      { name: "python", outcome: "ok", reason: null, diagnosis: null },
      { name: "rust", outcome: "failed", reason: "no cargo", diagnosis: null },
    ]);
    expect(state.describe).toEqual({
      total: 3,
      done: 2,
      failed: 1,
      firstFailure: { item: "b.py", reason: "timed out" },
    });
  });

  it("reads the running extract language as the plugin progress", () => {
    const state = of([
      planned("python"),
      {
        kind: "plugin-started",
        name: "python",
        progress: { done: 5, total: 40, unit: "files" },
        phase: "extract",
      },
    ]);

    expect(state.sensorProgress).toEqual({
      name: "python",
      phase: "extract",
      progress: { done: 5, total: 40, unit: "files" },
    });
    expect(state.extract).toBe("run");
  });

  it("a_running_extract_runs_estimate_reaches_run_progress", () => {
    const state = of([
      planned("python"),
      {
        kind: "plugin-started",
        name: "python",
        progress: { done: 5, total: 40, unit: "files" },
        phase: "extract",
      },
      {
        kind: "plugin-estimate",
        name: "python",
        phase: "extract",
        estimateMs: 5000,
      },
    ]);

    expect(state.extractEstimateMs).toBe(5000);
  });

  it("an_ended_extract_run_has_no_extract_estimate", () => {
    const state = of([
      planned("python"),
      {
        kind: "plugin-started",
        name: "python",
        progress: { done: 5, total: 40, unit: "files" },
        phase: "extract",
      },
      {
        kind: "plugin-estimate",
        name: "python",
        phase: "extract",
        estimateMs: 5000,
      },
      extractEnded("python"),
    ]);

    expect(state.extractEstimateMs).toBeNull();
  });

  it("reads the ask, the answer and the skipped state from the confirmation", () => {
    const ask = { modules: 4, model: "m", inputTokens: 10, costUsd: null };
    const asked = of([{ kind: "confirmation-asked", ask }]);

    expect(asked.describeAsk).toEqual(ask);
    expect(asked.describeSkipped).toBe(false);

    const skipped = of([
      { kind: "confirmation-asked", ask },
      { kind: "confirmation-answered", describe: false },
    ]);

    expect(skipped.describeAsk).toBeNull();
    expect(skipped.describeSkipped).toBe(true);
    expect(
      of([
        { kind: "confirmation-asked", ask },
        { kind: "confirmation-answered", describe: true },
      ]).describeSkipped,
    ).toBe(false);
    expect(
      of([{ kind: "confirmation-asked", ask }], {
        overlay: { stopped: true },
      }).describeAsk,
    ).toBeNull();
  });

  it("reads the stop and the log from the run", () => {
    const halt = {
      cause: "limit" as const,
      reason: "out of quota",
      described: 412,
      notDescribed: 1628,
      threshold: 4,
    };
    const state = of([
      describing(2040),
      item("a.py"),
      { kind: "describe-halted", halt },
      logged,
    ]);

    expect(state.describeStop).toEqual(halt);
    expect(state.describe?.done).toBe(1);
    expect(state.log).toBe("run-1");
  });

  it("is not extract pending once anything began", () => {
    expect(of([]).extract).toBe("pending");
    expect(
      of([{ kind: "structure", state: "running", files: null }]).extract,
    ).toBe("current");
  });
});

describe("extractRuns", () => {
  it("carries an extract run's total and the duration core recorded for it", () => {
    const run = (reports: [RunReport, number][]) =>
      reports
        .reduce(
          (held, [report, at]) => held.apply(report, at),
          Run.begin({
            id: "run-1",
            startedBy: "cli",
            startedAt: "2026-11-24T00:00:00.000Z",
            scope: { kind: "working-tree" },
            choices: { sensors: [], describe: false, suites: {} },
          }).apply(planned("python")),
        )
        .view();
    const started: [RunReport, number] = [
      {
        kind: "plugin-started",
        name: "python",
        progress: { done: 0, total: 40, unit: "files" },
        phase: "extract",
      },
      1000,
    ];

    expect(progressOfRun(run([started])).extractRuns).toEqual({
      python: { total: 40, durationMs: null },
    });
    expect(
      progressOfRun(run([started, [extractEnded("python"), 9000]])).extractRuns,
    ).toEqual({ python: { total: 40, durationMs: 8000 } });
  });
});

describe("scanningText", () => {
  const rows = [
    { key: "crap", display: "C.R.A.P." },
    { key: "duplication", display: "Duplication" },
  ];
  const led = [{ key: "describe", display: "Descriptions" }, ...rows];
  const midRun = of([extractCurrent, describing(0), sensed("crap")]);

  it("names the running sensor and its place among the sensors", () => {
    expect(scanningText(rows, "crap", midRun)).toBe("Running C.R.A.P.… 1 of 2");
  });

  it("reaches the last sensor", () => {
    expect(scanningText(rows, "duplication", midRun)).toBe(
      "Running Duplication… 2 of 2",
    );
  });

  it("leaves the describe row out of the sensor count", () => {
    expect(scanningText(led, "duplication", midRun)).toBe(
      "Running Duplication… 2 of 2",
    );
  });

  it("says Scanning alone before any row has started", () => {
    expect(scanningText(rows, null, NO_PROGRESS)).toBe("Scanning…");
  });

  it("counts files at zero right after the describe phase line", () => {
    expect(
      scanningText(led, "describe", of([extractCurrent, describing(40)])),
    ).toBe("Describing… 0 of 40 files");
  });

  it("counts finished files as entries arrive", () => {
    const entries = Array.from({ length: 12 }, (_, at) => item(`m${at}`));

    expect(
      scanningText(
        led,
        "describe",
        of([extractCurrent, describing(40), ...entries]),
      ),
    ).toBe("Describing… 12 of 40 files");
  });

  it("is null once the scan is done or stopped", () => {
    expect(
      scanningText(
        rows,
        "crap",
        of([extractCurrent, logged], { overlay: { done: true } }),
      ),
    ).toBe(null);
    expect(
      scanningText(rows, "crap", of([], { overlay: { stopped: true } })),
    ).toBe(null);
    expect(
      scanningText(
        rows,
        "crap",
        progressOfRun({
          ...Run.begin({
            id: "run-1",
            startedBy: "cli",
            startedAt: "2026-11-24T00:00:00.000Z",
            scope: { kind: "working-tree" },
            choices: { sensors: ["crap"], describe: false, suites: {} },
          })
            .apply({ kind: "running" })
            .stopped(null)
            .view(),
        }),
      ),
    ).toBe(null);
  });
});

describe("plugin progress", () => {
  const rows = [
    { key: "crap", display: "Crap" },
    { key: "mutation", display: "Mutation" },
  ];

  it("reads the extract phase with the plugin's name", () => {
    const extracting = of([
      planned("python"),
      {
        kind: "plugin-started",
        name: "python",
        progress: { done: 5, total: 40, unit: "files" },
        phase: "extract",
      },
    ]);

    expect(scanningText(rows, null, extracting)).toBe("Python: 5 of 40 files");
  });

  it("ignores another plugin's stored progress", () => {
    const mutation = rows;
    const running = of(
      [
        extractCurrent,
        describing(0),
        sensed("crap"),
        sensorEnded("crap"),
        sensed("mutation"),
        {
          kind: "plugin-progress",
          name: "mutation",
          progress: { done: 153, total: 229, unit: "functions" },
        },
      ],
      { sensors: ["crap", "mutation"] },
    );

    expect(scanningText(mutation, "mutation", running)).toBe(
      "Mutation: 153 of 229 functions",
    );
    expect(scanningText(mutation, "crap", running)).toBe(
      "Running Crap… 1 of 2",
    );
  });
});

describe("the extraction settle point", () => {
  it("is the first describe or sense phase line", () => {
    expect(of([planned("python")]).extractSettled).toBe(false);
    expect(of([planned("python"), extractEnded("python")]).extractSettled).toBe(
      false,
    );
    expect(
      of([planned("python"), extractEnded("python"), describing(1)])
        .extractSettled,
    ).toBe(true);
    expect(
      of([
        planned("python"),
        extractEnded("python"),
        describing(0),
        sensed("crap"),
      ]).extractSettled,
    ).toBe(true);
  });

  it("moves extract to current when a later phase or the summary arrives", () => {
    expect(of([planned("python")]).extract).toBe("run");
    expect(
      of([planned("python"), extractEnded("python"), describing(1)]).extract,
    ).toBe("current");
    expect(of([planned("python"), logged]).extract).toBe("current");
  });

  it("is the summary when no later phase ran", () => {
    expect(of([extractCurrent, logged]).extractSettled).toBe(true);
  });
});

describe("showTarget", () => {
  it("targets the first failed file, which wins over a failed sensor", () => {
    const state = of([
      extractCurrent,
      describing(2),
      item("a.py", "x"),
      item("b.py", "y"),
      sensed("crap"),
      sensorEnded("crap", "z"),
      logged,
    ]);

    expect(showTarget(state)).toEqual({
      kind: "module",
      id: "a.py",
      reason: "x",
    });
  });

  it("targets the failed sensor row when no file failed", () => {
    const state = of([
      extractCurrent,
      describing(0),
      sensed("crap"),
      sensorEnded("crap"),
      sensed("duplication"),
      sensorEnded("duplication", "z"),
      logged,
    ]);

    expect(showTarget(state)).toEqual({
      kind: "sensor",
      name: "duplication",
      reason: "z",
    });
  });

  it("has no target for an extract-only failure or no failure", () => {
    expect(
      showTarget(
        of([planned("python"), extractEnded("python", "boom"), logged]),
      ),
    ).toBeNull();
    expect(showTarget(of([extractCurrent, logged]))).toBeNull();
  });
});

describe("the describe confirmation", () => {
  it("holds the ask until it is answered and shows a waiting line", () => {
    const ask = {
      modules: 2040,
      model: "sonnet",
      inputTokens: 8_000_000,
      costUsd: 17.54,
    };
    const state = of([{ kind: "confirmation-asked", ask }]);

    expect(state.describeAsk).toEqual(ask);
    expect(scanningText([], "describe", state)).toBe("Waiting for your answer");

    const answered = (describe: boolean) =>
      of([
        { kind: "confirmation-asked", ask },
        { kind: "confirmation-answered", describe },
      ]);

    expect(answered(true).describeAsk).toBeNull();
    expect(answered(true).describeSkipped).toBe(false);
    expect(answered(false).describeAsk).toBeNull();
    expect(answered(false).describeSkipped).toBe(true);
  });

  it("words the card with the known and the unknown price", () => {
    expect(
      describeAskText({
        modules: 2040,
        model: "sonnet",
        inputTokens: 8_000_000,
        costUsd: 17.54,
      }),
    ).toEqual({
      heading: "Describe 2,040 files?",
      model: "Model: sonnet",
      estimate: "About 8.0M tokens, $17.54 at API prices",
    });
    expect(
      describeAskText({
        modules: 2040,
        model: "sonnet",
        inputTokens: 8_000_000,
        costUsd: null,
      }).estimate,
    ).toBe("About 8.0M tokens, price unknown");
  });

  it.each([
    [999, "999"],
    [1000, "1K"],
    [412_000, "412K"],
    [1_000_000, "1.0M"],
  ])("writes %i tokens as %s", (tokens, text) => {
    expect(tokensText(tokens)).toBe(text);
  });
});

describe("describeAskText with a describe rate", () => {
  const ask = {
    modules: 12,
    model: "sonnet",
    inputTokens: 8000,
    costUsd: 0.42,
  };

  it("appends the describe time to the cost", () => {
    expect(describeAskText(ask, 5000).estimate).toBe(
      "About 8K tokens, $0.42 at API prices, about 1 min",
    );
    expect(describeAskText(ask, 4000).estimate).toBe(
      "About 8K tokens, $0.42 at API prices, under a minute",
    );
  });

  it("leaves today's text exactly when there is no describe history", () => {
    expect(describeAskText(ask, null)).toEqual(describeAskText(ask));
    expect(describeAskText(ask, null).estimate).toBe(
      "About 8K tokens, $0.42 at API prices",
    );
  });
});

describe("the extract run line's languages", () => {
  it("folds the list into the progress", () => {
    expect(of([planned("python", "rust")]).languages).toEqual([
      "python",
      "rust",
    ]);
  });
});

describe("the describe stop event", () => {
  it("folds into the progress and leaves the entries alone", () => {
    const state = of([
      describing(2040),
      item("a.py"),
      {
        kind: "describe-halted",
        halt: {
          cause: "limit",
          reason: "out of quota",
          described: 412,
          notDescribed: 1628,
          threshold: 4,
        },
      },
    ]);

    expect(state.describeStop).toMatchObject({
      cause: "limit",
      described: 412,
      notDescribed: 1628,
    });
    expect(state.describe?.done).toBe(1);
  });
});

describe("a describe run that ended", () => {
  it("keeps its counts for the finished message", () => {
    const state = of([describing(1), item("a.py")]);

    expect(state.describe).toEqual({
      total: 1,
      done: 1,
      failed: 0,
      firstFailure: null,
    });
  });
});
