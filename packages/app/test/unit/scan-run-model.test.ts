import type { ScanRunRecord } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  NO_PROGRESS,
  parseScanLine,
  type ScanProgress,
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

function record(over: Partial<ScanRunRecord> = {}): ScanRunRecord {
  return {
    version: 5,
    suites: {},
    run_id: "run-1",
    pid: 4242,
    pgid: 4242,
    started_at: "2026-11-12T09:00:00.000Z",
    started_by: "app",
    repository: "/work/repo",
    sensors: ["crap", "mutation"],
    describe: false,
    phase: "running",
    ended_at: null,
    exit: null,
    gaps: [],
    failure: null,
    commit: null,
    ran: null,
    ...over,
  };
}

function view(
  over: Partial<ScanRunRecord> | null,
  progress: Partial<ScanProgress> = {},
  extra: Partial<RunView> = {},
): RunView {
  return {
    record: over === null ? null : record(over),
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
      view(
        { phase: "running" },
        {
          sensing: "mutation",
          sensorProgress: {
            name: "mutation",
            phase: "sense",
            progress: {
              done: 11,
              total: 29,
              unit: "functions",
              step: "unit",
            },
          },
        },
      ),
    );
    const coverage = model(
      view(
        { phase: "running" },
        {
          sensing: "crap",
          sensorProgress: {
            name: "crap",
            phase: "sense",
            note: "Coverage run for unit",
          },
        },
      ),
    );

    expect(run?.card).toMatchObject({
      head: "Scanning",
      line: "Mutation \u00b7 unit \u00b7 11/29",
    });
    expect(coverage?.card.line).toBe("C.R.A.P.");
  });

  it("reads Mutation 29/29 on a running record and a stopped one", () => {
    const progress = {
      sensing: "mutation",
      sensorProgress: {
        name: "mutation",
        phase: "sense" as const,
        progress: { done: 29, total: 29, unit: "functions" },
      },
    };

    expect(model(view({ phase: "running" }, progress))?.card.line).toBe(
      "Mutation \u00b7 29/29",
    );
    expect(
      model(view({ phase: "stopped", ended_at: ENDED, exit: 143 }, progress))
        ?.card.line,
    ).toBe("Kept Mutation 29/29");
  });

  it("reads the sensor and suite alone when it reports no count, and Finishing when none is current", () => {
    expect(
      model(view({ phase: "running" }, { sensing: "crap" }))?.card.line,
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

  it("reads the failed card with the short reason and a log link", () => {
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
    expect(bare?.card.line).toBe("x".repeat(60));
  });

  describe("a failure of the whole scan", () => {
    const REASON =
      "claude is not registered in .recognizer/config.yaml; register it with 'recognizer plugin add claude'.";
    const whole = (over: Partial<ScanRunRecord> = {}) => ({
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
      expect(run?.card.line).toBe(REASON.slice(0, 60));
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
    "reads the reason of a %s failure cut to the limit",
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

      expect(run?.card.line).toBe("r".repeat(60));
    },
  );

  it("reads the stopped card with the kept count, the skipped suites, and without counts", () => {
    const progress = {
      sensing: "mutation",
      sensorProgress: {
        name: "mutation",
        phase: "sense" as const,
        progress: { done: 11, total: 29, unit: "functions", step: "unit" },
      },
      startedSuites: { mutation: ["unit"] },
    };
    const stopped = { phase: "stopped", ended_at: ENDED, exit: 143 } as const;
    const counted = model(
      view({ ...stopped, suites: { mutation: ["unit"] } }, progress),
    );
    const one = model(
      view({ ...stopped, suites: { mutation: ["unit", "web"] } }, progress),
    );
    const two = model(
      view(
        { ...stopped, suites: { mutation: ["unit", "web", "e2e"] } },
        progress,
      ),
    );
    const plain = model(view({ phase: "stopped", ended_at: ENDED, exit: 143 }));

    expect(counted?.card).toMatchObject({
      head: "Scan stopped",
      line: "Kept Mutation 11/29 on unit",
    });
    expect(one?.card.line).toBe(
      "Kept Mutation 11/29 on unit \u00b7 skipped Mutation on web",
    );
    expect(two?.card.line).toBe(
      "Kept Mutation 11/29 on unit \u00b7 skipped Mutation on web \u00b7 skipped Mutation on e2e",
    );
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
        { phase: "stopped", ended_at: ENDED, exit: 143 },
        {
          sensing: "mutation",
          sensorProgress: {
            name: "mutation",
            phase: "sense",
            progress: { done: 11, total: 29, unit: "functions" },
          },
        },
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
  const timing = (over: Partial<ScanProgress["timing"]>) => ({
    ...NO_PROGRESS.timing,
    ...over,
  });
  const running = (
    over: Partial<ScanRunRecord>,
    progress: Partial<ScanProgress>,
  ) =>
    model(view({ started_at: new Date(T0).toISOString(), ...over }, progress));

  it("reads about N min left from the frozen figures", () => {
    const card = running(
      { sensors: ["crap"] },
      {
        timing: timing({
          frozen: { structure: 0, crap: 600_000 },
          sensorAt: { crap: T0 },
        }),
      },
    )?.card;

    expect(card?.when.text).toBe("about 9 min left");
    expect(card?.when.title).toBeUndefined();
  });

  it("names an overrun in the card text and hover", () => {
    const card = running(
      { sensors: ["crap"] },
      {
        timing: timing({
          frozen: { structure: 0, crap: 30_000 },
          sensorAt: { crap: T0 },
        }),
      },
    )?.card;

    expect(card?.when.text).toBe("C.R.A.P.: longer than estimated");
    expect(card?.when.title).toBe(
      "C.R.A.P.: past its estimate of under a minute",
    );
  });

  it("names the parts it is not counting in the hover", () => {
    const card = running(
      {},
      { timing: timing({ frozen: { structure: 0, crap: 600_000 } }) },
    )?.card;

    expect(card?.when.title).toBe("not counting Mutation: no estimate yet");
  });

  it("keeps the clock for a command-line run", () => {
    const card = running(
      { started_by: "cli" },
      { timing: timing({ frozen: { structure: 0, crap: 600_000 } }) },
    )?.card;

    expect(card?.when.text).toMatch(/^\d\d:\d\d$/);
  });

  it("keeps the clock when nothing was frozen", () => {
    expect(running({}, {})?.card.when.text).toMatch(/^\d\d:\d\d$/);
  });

  it("keeps the clock on a finished card and in every other phase", () => {
    const frozen = timing({ frozen: { structure: 0, crap: 600_000 } });

    for (const phase of ["finished", "stopped", "checking"] as const) {
      const card = running(
        { phase, ended_at: ENDED },
        { timing: frozen },
      )?.card;

      expect(card?.when.text).toMatch(/^\d\d:\d\d$/);
    }
  });

  it("keeps the clock while starting", () => {
    const card = model(view({}, {}, { starting: { at: NOW } }))?.card;

    expect(card?.when.text).toMatch(/^\d\d:\d\d$/);
  });
});

describe("extract timing per language", () => {
  const line = (event: object) => {
    const parsed = parseScanLine(JSON.stringify(event));

    if (parsed === null) {
      throw new Error("unparsed line");
    }

    return parsed;
  };
  const plugin = (name: string, data: object) =>
    line({ event: "plugin", phase: "extract", name, data });

  it("stamps the first event, the total and the entry of each language", () => {
    const folded = [
      [100, plugin("python", { event: "start", total: 40, unit: "files" })],
      [
        150,
        plugin("python", {
          event: "progress",
          done: 10,
          total: 40,
          unit: "files",
        }),
      ],
      [
        900,
        line({
          event: "entry",
          phase: "extract",
          name: "python",
          outcome: "ok",
        }),
      ],
      [1000, plugin("rust", { event: "start", total: 7, unit: "files" })],
    ].reduce<ScanProgress>(
      (state, [at, event]) =>
        runModelModule.foldRunLine(
          state,
          event as Parameters<typeof runModelModule.foldRunLine>[1],
          at as number,
        ),
      NO_PROGRESS,
    );

    expect(folded.timing.extractAt).toEqual({ python: 100, rust: 1000 });
    expect(folded.timing.extractDoneAt).toEqual({ python: 900 });
    expect(folded.timing.extractTotals).toEqual({ python: 40, rust: 7 });
  });
});

describe("the run's work across steps", () => {
  const sense = (name: string, data: object) =>
    parseScanLine(
      JSON.stringify({ event: "plugin", phase: "sense", name, data }),
    );
  const fold = (lines: [number, object | null][]) =>
    lines.reduce<ScanProgress>(
      (state, [at, event]) =>
        runModelModule.foldRunLine(
          state,
          event as Parameters<typeof runModelModule.foldRunLine>[1],
          at,
        ),
      NO_PROGRESS,
    );
  const progress = (done: number, unit: string, step?: string) =>
    sense("mutation", {
      event: "progress",
      done,
      total: 100,
      unit,
      ...(step === undefined ? {} : { step }),
    });
  const start = sense("mutation", {
    event: "start",
    total: 150,
    unit: "functions",
    queued: 30,
  });

  it("starts from queued, or from total without it", () => {
    expect(fold([[1, start]]).timing.runWork).toEqual({
      work: 30,
      queued: true,
      unit: "functions",
      at: null,
      current: null,
      steps: {},
    });
    expect(
      fold([[1, sense("crap", { event: "start", total: 2, unit: "suites" })]])
        .timing.runWork,
    ).toMatchObject({ work: 2, queued: false });
  });

  it("sums the progress since each step's first event", () => {
    const folded = fold([
      [1, start],
      [10, progress(80, "functions", "a")],
      [20, progress(100, "functions", "a")],
      [20, progress(50, "functions", "b")],
      [30, progress(53, "functions", "b")],
    ]);

    expect(folded.timing.runWork?.at).toBe(10);
    expect(folded.timing.runWork?.steps).toEqual({
      a: { first: 80, latest: 100, firstAt: 10, lastAt: 20 },
      b: { first: 50, latest: 53, firstAt: 20, lastAt: 30 },
    });
    expect(folded.timing.runWork?.current).toBe("b");
  });

  it("ignores a progress of another unit", () => {
    const folded = fold([
      [1, start],
      [10, progress(5, "suites")],
    ]);

    expect(folded.timing.runWork?.steps).toEqual({});
    expect(folded.timing.runWork?.at).toBeNull();
  });

  it("resets on the next plugin start", () => {
    const folded = fold([
      [1, start],
      [10, progress(80, "functions", "a")],
      [20, start],
    ]);

    expect(folded.timing.runWork?.steps).toEqual({});
    expect(folded.timing.runWork?.at).toBeNull();
  });
});
