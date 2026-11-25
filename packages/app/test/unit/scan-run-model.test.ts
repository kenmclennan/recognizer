import type { PluginRunView, RunView as Run, RunState } from "@recognizer/core";
import type { ScanRunRecord } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  NO_PROGRESS,
  NO_TIMING,
  type RunProgress,
  stampTiming,
} from "../../src/scan-progress";
import * as runModelModule from "../../src/scan-run-model";
import { type RunView, runModel } from "../../src/scan-run-model";

const NAMES: Record<string, string> = {
  crap: "C.R.A.P.",
  mutation: "Mutation",
  duplication: "Duplication",
};
const display = (name: string) => NAMES[name] ?? name;
const ALL = new Set(["crap", "mutation", "duplication"]);
const NOW = Date.parse("2026-11-12T09:30:00.000Z");

function clock(iso: string): string {
  const at = new Date(iso);

  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

type RunOver = {
  run_id?: string;
  started_at?: string;
  started_by?: "cli" | "app";
  sensors?: string[];
  describe?: boolean;
  suites?: Record<string, string[]>;
  phase?: ScanRunRecord["phase"];
  ended_at?: string | null;
  exit?: number | null;
  gaps?: ScanRunRecord["gaps"];
  failure?: ScanRunRecord["failure"];
  ran?: ScanRunRecord["ran"];
};

type PluginOver = Partial<PluginRunView> & { name: string };

function pluginRun(over: PluginOver): PluginRunView {
  return {
    phase: "sense",
    state: "queued",
    progress: null,
    stage: null,
    estimateMs: null,
    failure: null,
    tally: null,
    ...over,
  };
}

const ENDED_PLUGIN: Record<string, PluginRunView["state"]> = {
  finished: "finished",
  failed: "finished",
  stopped: "stopped",
  refused: "stopped",
};

function runOf(over: RunOver, plugins?: PluginOver[]): Run {
  const sensors = over.sensors ?? ["crap", "mutation"];
  const phase = over.phase ?? "running";

  return {
    id: over.run_id ?? "run-1",
    startedBy: over.started_by ?? "app",
    startedAt: over.started_at ?? "2026-11-12T09:00:00.000Z",
    scope: { kind: "working-tree" },
    sensors,
    describe: over.describe ?? false,
    suites: over.suites ?? {},
    state: phase as RunState,
    endedAt: over.ended_at ?? null,
    exit: over.exit ?? null,
    gaps: over.gaps ?? [],
    failure: over.failure ?? null,
    ran: over.ran ?? null,
    plugins: (
      plugins ??
      sensors.map((name) => ({
        name,
        state: ENDED_PLUGIN[phase] ?? "queued",
      }))
    ).map(pluginRun),
    confirmation: null,
    describeHalt: null,
    structure: null,
    log: null,
  };
}

function view(
  over: RunOver | null,
  progress: Partial<RunProgress> = {},
  extra: Partial<RunView> = {},
  plugins?: PluginOver[],
): RunView {
  return {
    run: over === null ? null : runOf(over, plugins),
    progress: { ...NO_PROGRESS, ...progress },
    display,
    starting: null,
    adoptedAtOpen: null,
    ...extra,
  };
}

const model = (v: RunView | null) => runModel(v, ALL, ALL, NOW);

const ENDED = "2026-11-12T09:05:00.000Z";

describe("the run model", () => {
  it.each([
    ["app", null, "Started here at"],
    ["cli", "terminal", "Started from the command line at"],
  ] as const)(
    "reads the checking card with its %s origin line and a locked panel",
    (by, icon, words) => {
      const run = model(view({ phase: "checking", started_by: by }));

      expect(run?.card).toMatchObject({
        head: "Checking tools",
        line: null,
        tone: "run",
        when: { text: clock("2026-11-12T09:00:00.000Z") },
        origin: { icon, text: `${words} ${clock("2026-11-12T09:00:00.000Z")}` },
      });
      expect(run?.active).toBe(true);
      expect(run?.subtitle).toBe(
        by === "cli"
          ? "A scan is running from the command line."
          : "A scan is running.",
      );
      expect(run?.button).toEqual({
        label: by === "cli" ? "Stop this scan" : "Stop",
        stop: true,
      });
    },
  );

  it("reads the refused card with each gap, the sensors it needs and one help line per reporting sensor", () => {
    const run = model(
      view({
        phase: "refused",
        started_by: "cli",
        ended_at: ENDED,
        exit: 4,
        gaps: [
          {
            id: "crap:python:env",
            line: "coverage is missing",
            needs: ["crap"],
          },
          { id: "crap:config:none", line: "no suites", needs: ["crap"] },
          { id: "no-commit", line: "no commit", needs: ["crap", "mutation"] },
        ],
      }),
    );

    expect(run?.card).toMatchObject({
      head: "Nothing ran",
      line: "Set it up or untick the suite.",
      gaps: [
        { line: "coverage is missing", where: "C.R.A.P." },
        { line: "no suites", where: "C.R.A.P." },
        { line: "no commit", where: "C.R.A.P., Mutation" },
      ],
      help: [
        {
          sensor: "crap",
          text: "To set this up with an agent:",
          command: "recognizer help sensors crap",
        },
      ],
    });
    expect(run?.button).toEqual({ label: "Check again and scan", stop: false });
    expect(run?.subtitle).toBe("Pick what to measure, then scan.");
    expect(run?.card.origin).toEqual({
      icon: "terminal",
      text: `Started from the command line at ${clock("2026-11-12T09:00:00.000Z")}`,
    });
  });

  it("reads the running card naming the sensor, the suite and the count", () => {
    const run = model(
      view({ phase: "running", sensors: ["mutation"] }, {}, {}, [
        {
          name: "mutation",
          state: "running",
          stage: { name: "unit", index: 1, of: 2 },
          progress: { done: 11, total: 29, unit: "functions" },
        },
      ]),
    );
    const coverage = model(
      view({ phase: "running", sensors: ["crap"] }, {}, {}, [
        { name: "crap", state: "running" },
      ]),
    );

    expect(run?.card).toMatchObject({
      head: "Scanning",
      line: "Mutation \u00b7 unit \u00b7 11/29",
    });
    expect(coverage?.card.line).toBe("C.R.A.P.");
  });

  it("the_card_names_the_stage_of_the_running_plugin", () => {
    const run = model(
      view({ phase: "running", sensors: ["crap"] }, {}, {}, [
        {
          name: "crap",
          state: "running",
          stage: { name: "Coverage run: unit", index: 1, of: 3 },
        },
      ]),
    );

    expect(run?.card.line).toBe("C.R.A.P. \u00b7 Coverage run: unit");
  });

  it("reads Mutation 29/29 on a running run and a stopped one", () => {
    const plugins = (state: "running" | "stopped") => [
      {
        name: "mutation",
        state,
        progress: { done: 29, total: 29, unit: "functions" },
      },
    ];
    const only = { sensors: ["mutation"] };

    expect(
      model(view({ phase: "running", ...only }, {}, {}, plugins("running")))
        ?.card.line,
    ).toBe("Mutation \u00b7 29/29");
    expect(
      model(
        view(
          { phase: "stopped", ended_at: ENDED, exit: 143, ...only },
          {},
          {},
          plugins("stopped"),
        ),
      )?.card.line,
    ).toBe("Kept Mutation 29/29");
  });

  it("reads the sensor alone when it reports no count, and Finishing when none is current", () => {
    expect(
      model(
        view({ phase: "running", sensors: ["crap"] }, {}, {}, [
          { name: "crap", state: "running" },
        ]),
      )?.card.line,
    ).toBe("C.R.A.P.");
    expect(model(view({ phase: "running" }))?.card.line).toBe("Finishing");
  });

  it("reads the finished card with the number of measured sensors", () => {
    const run = model(
      view({
        phase: "finished",
        ended_at: ENDED,
        exit: 0,
        describe: true,
        started_by: "cli",
      }),
    );

    expect(run?.card).toMatchObject({
      head: "Scan finished",
      line: "3 sensors measured",
      when: { text: clock(ENDED) },
      origin: {
        icon: "terminal",
        text: `Started from the command line at ${clock("2026-11-12T09:00:00.000Z")}`,
      },
      tone: "ok",
    });
    expect(run?.active).toBe(false);
    expect(run?.subtitle).toBe("Pick what to measure, then scan.");
    expect(run?.button).toEqual({ label: "Scan", stop: false });
  });

  it("reads the failed card with the whole reason and a log link", () => {
    const run = model(
      view(
        {
          phase: "failed",
          ended_at: ENDED,
          exit: 1,
          failure: {
            sensor: "crap",
            suite: "web",
            code: "coverage-unavailable",
            reason: "suite web left no coverage report at coverage/lcov.info",
          },
        },
        { log: "20261112-scan" },
      ),
    );
    const bare = model(
      view({
        phase: "failed",
        ended_at: ENDED,
        exit: 1,
        failure: {
          sensor: "crap",
          suite: null,
          code: null,
          reason: "x".repeat(80),
        },
      }),
    );

    expect(run?.card).toMatchObject({
      head: "C.R.A.P. failed on web",
      line: "suite web left no coverage report at coverage/lcov.info",
      lineTitle: "suite web left no coverage report at coverage/lcov.info",
      showLog: ".recognizer/cache/log/20261112-scan.json",
      tone: "bad",
    });
    expect(bare?.card.head).toBe("C.R.A.P. failed");
    expect(bare?.card.line).toBe("x".repeat(80));
  });

  describe("a failure of the whole scan", () => {
    const REASON =
      "claude is not registered in .recognizer/config.yaml; register it with 'recognizer plugin add claude'.";
    const whole = (over: RunOver = {}) => ({
      phase: "failed" as const,
      ended_at: ENDED,
      exit: 1,
      failure: { sensor: "scan", suite: null, code: null, reason: REASON },
      ...over,
    });
    const named = {
      display: (name: string) =>
        name === "scan" ? "Structure" : display(name),
    };

    it("a failure before any phase reads Scan did not start with the reason", () => {
      const run = model(view(whole(), {}, named));

      expect(run?.card.head).toBe("Scan did not start");
      expect(run?.card.line).toBe(REASON);
      expect(run?.card.lineTitle).toBe(REASON);
      expect(run?.card.tone).toBe("bad");
    });

    it("a scan failure after extract began reads Scan failed", () => {
      const run = model(view(whole(), { extract: "run" }, named));

      expect(run?.card.head).toBe("Scan failed");
    });

    it("a scan failure with a summary reads Scan failed", () => {
      const run = model(view(whole({ ran: ["extract"] }), {}, named));

      expect(run?.card.head).toBe("Scan failed");
    });
  });

  it.each(["tests-failed", "custom-code"])(
    "reads the whole reason of a %s failure",
    (code) => {
      const run = model(
        view({
          phase: "failed",
          ended_at: ENDED,
          exit: 1,
          failure: {
            sensor: "crap",
            suite: "unit",
            code,
            reason: "r".repeat(90),
          },
        }),
      );

      expect(run?.card.line).toBe("r".repeat(90));
    },
  );

  it("reads the stopped card with the kept count and without counts", () => {
    const stopped = { phase: "stopped", ended_at: ENDED, exit: 143 } as const;
    const counted = model(
      view({ ...stopped, sensors: ["mutation"] }, {}, {}, [
        {
          name: "mutation",
          state: "stopped",
          stage: { name: "unit", index: 1, of: 2 },
          progress: { done: 11, total: 29, unit: "functions" },
        },
      ]),
    );
    const plain = model(view({ phase: "stopped", ended_at: ENDED, exit: 143 }));

    expect(counted?.card).toMatchObject({
      head: "Scan stopped",
      line: "Kept Mutation 11/29 on unit",
    });
    expect(counted?.partial).toEqual({
      sensor: "mutation",
      text: "11 of 29, 25 minutes ago",
    });
    expect(plain?.card.line).toBe("Finished results kept");
    expect(plain?.partial).toBeNull();
  });

  it("shows the partial row as just now for a run that ended this minute", () => {
    const run = runModel(
      view(
        { phase: "stopped", ended_at: ENDED, exit: 143, sensors: ["mutation"] },
        {},
        {},
        [
          {
            name: "mutation",
            state: "stopped",
            progress: { done: 11, total: 29, unit: "functions" },
          },
        ],
      ),
      ALL,
      ALL,
      Date.parse(ENDED) + 5000,
    );

    expect(run?.partial?.text).toBe("11 of 29, just now");
  });

  it("reads the checking card with the click's time while starting, and Stop", () => {
    const at = Date.parse("2026-11-12T10:15:00.000Z");
    const run = model(
      view(
        { phase: "refused", ended_at: ENDED, exit: 4, gaps: [] },
        {},
        { starting: { at } },
      ),
    );

    expect(run?.card).toMatchObject({
      head: "Checking tools",
      gaps: [],
      origin: { icon: null },
    });
    expect(run?.card.origin.text).toMatch(/^Started here at \d\d:\d\d$/);
    expect(run?.card.when.text).toMatch(/^\d\d:\d\d$/);
    expect(run?.button.stop).toBe(true);
  });

  it("replaces the first run's gaps once a newer run id arrives", () => {
    const gap = { id: "crap:a", line: "no tool", needs: ["crap"] };
    const first = model(
      view({
        run_id: "run-1",
        phase: "refused",
        ended_at: ENDED,
        exit: 4,
        gaps: [gap],
      }),
    );
    const second = model(
      view({ run_id: "run-2", phase: "checking", started_by: "cli" }),
    );

    expect(first?.card.gaps).toHaveLength(1);
    expect(second?.card.gaps).toEqual([]);
    expect(second?.card.head).toBe("Checking tools");
  });

  it("hides an ended record the window opened with and shows a running one", () => {
    const ended = { phase: "finished", ended_at: ENDED, exit: 0 } as const;

    expect(
      model(view({ ...ended, run_id: "r9" }, {}, { adoptedAtOpen: "r9" })),
    ).toBeNull();
    expect(
      model(view({ ...ended, run_id: "r10" }, {}, { adoptedAtOpen: "r9" })),
    ).not.toBeNull();
    expect(
      model(
        view({ phase: "running", run_id: "r9" }, {}, { adoptedAtOpen: "r9" }),
      ),
    ).not.toBeNull();
  });

  it("has no card without a record and not starting", () => {
    expect(model(view(null))).toBeNull();
    expect(model(null)).toBeNull();
  });

  it("exports none of the long card texts REC-488 had", () => {
    for (const name of [
      "KEPT_OTHERS_TEXT",
      "KEPT_FINISHED_TEXT",
      "CHECKING_LINE",
    ]) {
      expect(name in runModelModule).toBe(false);
    }
  });
});

describe("the time slot while an app-driven scan runs", () => {
  const T0 = NOW - 60_000;
  const running = (
    over: RunOver,
    plugins: PluginOver[],
    extra: Partial<RunView> = {},
  ) =>
    model(
      view(
        { started_at: new Date(T0).toISOString(), ...over },
        {},
        extra,
        plugins,
      ),
    );
  const live = (name: string, estimateMs: number | null): PluginOver => ({
    name,
    state: "running",
    estimateMs,
  });

  it("reads about N min left from the reported estimates", () => {
    const card = running({ sensors: ["crap"] }, [live("crap", 600_000)])?.card;

    expect(card?.when.text).toBe("about 10 min left");
    expect(card?.when.title).toBeUndefined();
  });

  it("names the plugins that have not reported in the hover", () => {
    const card = running({}, [
      live("crap", 600_000),
      { name: "mutation", state: "queued" },
    ])?.card;

    expect(card?.when.text).toBe("No estimate yet");
    expect(card?.when.title).toContain("Mutation");
    expect(card?.when.title).not.toContain("C.R.A.P.");
  });

  it("a_run_reads_no_estimate_yet_while_a_queued_plugin_has_not_reported", () => {
    const card = running({}, [
      live("crap", 40_000),
      { name: "mutation", state: "queued" },
    ])?.card;

    expect(card?.when.text).toBe("No estimate yet");
    expect(card?.when.title).toContain("Mutation");
  });

  it("a_queued_plugin_with_history_contributes_its_planned_estimate_before_its_first_stage", () => {
    const card = running(
      {},
      [live("crap", 40_000), { name: "mutation", state: "queued" }],
      { plannedMs: { mutation: 5 * 60_000 } },
    )?.card;

    expect(card?.when.text).toBe("about 6 min left");
    expect(card?.when.title).toBeUndefined();
  });

  it("a_started_plugin_that_has_not_reported_keeps_its_history_estimate", () => {
    const card = running({}, [live("crap", null)], {
      plannedMs: { crap: 40_000 },
    })?.card;

    expect(card?.when.text).toBe("under a minute left");
    expect(card?.when.title).toBeUndefined();
  });

  it("a_started_plugin_own_estimate_replaces_its_history_estimate", () => {
    const card = running({}, [live("crap", 600_000)], {
      plannedMs: { crap: 40_000 },
    })?.card;

    expect(card?.when.text).toBe("about 10 min left");
  });

  it("a_started_plugin_without_history_that_has_not_reported_reads_no_estimate_yet", () => {
    const card = running({}, [live("crap", null)])?.card;

    expect(card?.when.text).toBe("No estimate yet");
    expect(card?.when.title).toContain("C.R.A.P.");
  });

  it("a_queued_plugin_without_history_still_reads_no_estimate_yet", () => {
    const card = running(
      {},
      [live("crap", 40_000), { name: "mutation", state: "queued" }],
      { plannedMs: { crap: 40_000 } },
    )?.card;

    expect(card?.when.text).toBe("No estimate yet");
    expect(card?.when.title).toContain("Mutation");
  });

  it("a_plugin_that_reports_none_reads_no_estimate_yet", () => {
    const card = running({ sensors: ["crap"] }, [live("crap", null)])?.card;

    expect(card?.when.text).toBe("No estimate yet");
  });

  it("a_run_reads_the_sum_of_every_live_plugins_estimate", () => {
    const sum = (a: number, b: number) =>
      running({}, [live("crap", a), live("mutation", b)])?.card.when.text;

    expect(sum(5 * 60_000, 4 * 60_000)).toBe("about 9 min left");
    expect(sum(30_000, 30_000)).toBe("about 1 min left");
    expect(sum(30_000, 29_999)).toBe("under a minute left");
  });

  it("a_mutation_run_of_hours_never_reads_under_a_minute_at_a_stage_boundary", () => {
    const hour = 3_600_000;
    const at = (index: number, estimateMs: number) =>
      running({ sensors: ["mutation"] }, [
        {
          name: "mutation",
          state: "running",
          stage: { name: `suite ${index}`, index, of: 2 },
          estimateMs,
        },
      ])?.card;
    const cards = [at(1, 3 * hour), at(2, 3 * hour), at(2, 3 * hour - 60_000)];
    const texts = cards.map((card) => card?.when.text);

    expect(texts).toEqual([
      "about 3 h left",
      "about 3 h left",
      "about 2 h 59 min left",
    ]);

    for (const text of texts) {
      expect(text).not.toContain("under a minute");
      expect(text).not.toBe("No estimate yet");
    }
  });

  it("keeps the clock for a command-line run", () => {
    const card = running({ started_by: "cli" }, [live("crap", 600_000)])?.card;

    expect(card?.when.text).toMatch(/^\d\d:\d\d$/);
  });

  it("keeps the clock when the run has no sensor plugin runs", () => {
    expect(running({ sensors: [] }, [])?.card.when.text).toMatch(/^\d\d:\d\d$/);
  });

  it("keeps the clock on a finished card and in every other phase", () => {
    for (const phase of ["finished", "stopped", "checking"] as const) {
      const card = running({ phase, ended_at: ENDED }, [
        live("crap", 600_000),
      ])?.card;

      expect(card?.when.text).toMatch(/^\d\d:\d\d$/);
    }
  });

  it("keeps the clock while starting", () => {
    const card = model(view({}, {}, { starting: { at: NOW } }))?.card;

    expect(card?.when.text).toMatch(/^\d\d:\d\d$/);
  });
});

it("the_card_reads_gaps_failure_and_ran_from_the_run", () => {
  const gap = { id: "crap:a", line: "no tool", needs: ["crap"] };
  const refused = model(
    view({ phase: "refused", ended_at: ENDED, exit: 4, gaps: [gap] }),
  );
  const sensorFailure = model(
    view({
      phase: "failed",
      ended_at: ENDED,
      exit: 1,
      failure: { sensor: "crap", suite: "web", code: null, reason: "broke" },
    }),
  );
  const wholeFailure = model(
    view({
      phase: "failed",
      ended_at: ENDED,
      exit: 1,
      ran: null,
      failure: { sensor: "scan", suite: null, code: null, reason: "no claude" },
    }),
  );
  const stopped = model(
    view(
      { phase: "stopped", ended_at: ENDED, exit: 143, sensors: ["crap"] },
      {},
      {},
      [
        {
          name: "crap",
          state: "stopped",
          progress: { done: 1, total: 4, unit: "functions" },
        },
      ],
    ),
  );

  expect(refused?.card.gaps).toEqual([
    { id: "crap:a", line: "no tool", where: "C.R.A.P." },
  ]);
  expect(sensorFailure?.card.head).toBe("C.R.A.P. failed on web");
  expect(wholeFailure?.card.head).toBe("Scan did not start");
  expect(stopped?.card.line).toBe("Kept C.R.A.P. 1/4");
});

describe("extract timing per language", () => {
  const snapshot = (plugins: PluginOver[]) => runOf({ sensors: [] }, plugins);

  it("stamps the first event, the total and the entry of each language", () => {
    const python = (state: PluginRunView["state"], done: number) => ({
      name: "python",
      phase: "extract" as const,
      state,
      progress: { done, total: 40, unit: "files" },
    });
    const first = stampTiming(
      NO_TIMING,
      snapshot([python("running", 0), { name: "rust", phase: "extract" }]),
      100,
    );
    const moved = stampTiming(first, snapshot([python("running", 10)]), 150);
    const ended = stampTiming(
      moved,
      snapshot([
        python("finished", 40),
        {
          name: "rust",
          phase: "extract",
          state: "running",
          progress: { done: 0, total: 7, unit: "files" },
        },
      ]),
      900,
    );

    expect(first.extractAt).toEqual({ python: 100 });
    expect(moved.extractAt).toEqual({ python: 100 });
    expect(ended.extractAt).toEqual({ python: 100, rust: 900 });
    expect(ended.extractDoneAt).toEqual({ python: 900 });
    expect(ended.extractTotals).toEqual({ python: 40, rust: 7 });
  });
});

describe("the card with extract and describe plugin runs", () => {
  const running = (plugins: PluginOver[], over: RunOver = {}) =>
    model(
      view({ phase: "running", sensors: ["crap"], ...over }, {}, {}, plugins),
    );

  it("reads a running extract run as the language, its stage and its count", () => {
    expect(
      running([
        {
          name: "python",
          phase: "extract",
          state: "running",
          progress: { done: 12, total: 40, unit: "files" },
        },
        { name: "crap" },
      ])?.card.line,
    ).toBe("Python \u00b7 12/40");
    expect(
      running([
        {
          name: "python",
          phase: "extract",
          state: "running",
          stage: { name: "parse", index: 1, of: 2 },
          progress: { done: 1, total: 4, unit: "files" },
        },
        { name: "crap" },
      ])?.card.line,
    ).toBe("Python \u00b7 parse \u00b7 1/4");
  });

  it("reads a running describe run as the descriptions count", () => {
    expect(
      running(
        [
          {
            name: "describe",
            phase: "describe",
            state: "running",
            progress: { done: 3, total: 10, unit: "files" },
          },
          { name: "crap" },
        ],
        { describe: true },
      )?.card.line,
    ).toBe("Descriptions: 3 of 10 files");
  });

  it("counts the describe run once in the measured line", () => {
    const finished = model(
      view(
        {
          phase: "finished",
          ended_at: ENDED,
          exit: 0,
          describe: true,
          sensors: ["crap", "mutation"],
        },
        {},
        {},
        [
          { name: "describe", phase: "describe", state: "finished" },
          { name: "crap", state: "finished" },
          { name: "mutation", state: "finished" },
        ],
      ),
    );

    expect(finished?.card.line).toBe("3 sensors measured");
  });

  it("reads the sensor's figure when extract and describe runs are still queued", () => {
    const card = running(
      [
        { name: "python", phase: "extract" },
        { name: "describe", phase: "describe" },
        { name: "crap", state: "running", estimateMs: 600_000 },
      ],
      { started_by: "app", describe: true },
    )?.card;

    expect(card?.when.text).toBe("about 10 min left");
  });

  it("reads the kept counts from the sensor run, not an extract run", () => {
    const stopped = model(
      view({ phase: "stopped", ended_at: ENDED, exit: 143 }, {}, {}, [
        {
          name: "crap",
          state: "stopped",
          progress: { done: 1, total: 4, unit: "files" },
        },
        {
          name: "python",
          phase: "extract",
          state: "stopped",
          progress: { done: 9, total: 9, unit: "files" },
        },
      ]),
    );

    expect(stopped?.card.line).toBe("Kept C.R.A.P. 1/4");
  });
});
