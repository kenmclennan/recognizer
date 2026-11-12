import type { ScanRunRecord } from "recognizer";
import { describe, expect, it } from "vitest";
import { NO_PROGRESS, type ScanProgress } from "./scan-progress";
import { type RunView, runModel } from "./scan-run-model";

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
    version: 3,
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
    ["app", "Started here at", null],
    ["cli", "Started from the command line at", "terminal"],
  ] as const)(
    "reads the checking card with its %s origin line and a locked panel",
    (by, origin, icon) => {
      const run = model(view({ phase: "checking", started_by: by }));

      expect(run?.card).toMatchObject({
        head: "Checking before the scan",
        line: "Making sure every ticked sensor's tools are in place.",
        tone: "run",
        origin: {
          icon,
          text: `${origin} ${clock("2026-11-12T09:00:00.000Z")}`,
        },
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
      line: "Set these up, then scan again.",
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
    expect(run?.card.origin.icon).toBe("terminal");
  });

  it("reads the running card naming the current sensor and its count", () => {
    const run = model(
      view(
        { phase: "running" },
        {
          sensing: "mutation",
          sensorProgress: {
            name: "mutation",
            step: "mutants",
            done: 11,
            total: 29,
          },
        },
      ),
    );

    expect(run?.card).toMatchObject({
      head: "Scanning",
      line: "Mutation: 11 of 29 functions",
    });
  });

  it("reads Mutation at 29 of 29 on a running record and a stopped one", () => {
    const progress = {
      sensing: "mutation",
      sensorProgress: {
        name: "mutation",
        step: "mutants" as const,
        done: 29,
        total: 29,
      },
    };

    expect(model(view({ phase: "running" }, progress))?.card.line).toBe(
      "Mutation: 29 of 29 functions",
    );
    expect(
      model(view({ phase: "stopped", ended_at: ENDED, exit: 143 }, progress))
        ?.card.line,
    ).toBe("Mutation kept 29 of 29 functions it had measured.");
  });

  it("reads the sensor's name alone when it reports no count, and Finishing when none is current", () => {
    expect(
      model(view({ phase: "running" }, { sensing: "crap" }))?.card.line,
    ).toBe("C.R.A.P.");
    expect(model(view({ phase: "running" }))?.card.line).toBe("Finishing");
  });

  it("reads the finished card with the measured sensors and Descriptions when describe ran", () => {
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
      head: `Scan finished at ${clock(ENDED)}`,
      line: "C.R.A.P., Mutation, Descriptions measured.",
      tone: "ok",
    });
    expect(run?.active).toBe(false);
    expect(run?.subtitle).toBe("Pick what to measure, then scan.");
    expect(run?.button).toEqual({ label: "Scan", stop: false });
  });

  it("reads the failed card with the reason, a log link and the kept line", () => {
    const run = model(
      view(
        {
          phase: "failed",
          ended_at: ENDED,
          exit: 1,
          failure: { sensor: "crap", reason: "coverage unavailable" },
        },
        { log: "20261112-scan" },
      ),
    );

    expect(run?.card).toMatchObject({
      head: `Scan finished at ${clock(ENDED)}, C.R.A.P. failed`,
      line: "coverage unavailable",
      showLog: ".recognizer/cache/log/20261112-scan.json",
      second: "The other sensors' results were kept.",
      tone: "bad",
    });
  });

  it("reads the stopped card with the counts of the sensor current at the stop, and without counts", () => {
    const counted = model(
      view(
        { phase: "stopped", ended_at: ENDED, exit: 143 },
        {
          sensing: "mutation",
          sensorProgress: {
            name: "mutation",
            step: "mutants",
            done: 11,
            total: 29,
          },
        },
      ),
    );
    const plain = model(view({ phase: "stopped", ended_at: ENDED, exit: 143 }));

    expect(counted?.card).toMatchObject({
      head: `Scan stopped at ${clock(ENDED)}`,
      line: "Mutation kept 11 of 29 functions it had measured.",
    });
    expect(counted?.partial).toEqual({
      sensor: "mutation",
      text: "11 of 29, 25 minutes ago",
    });
    expect(plain?.card.line).toBe(
      "Results finished before the stop were kept.",
    );
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
            step: "mutants",
            done: 11,
            total: 29,
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
      head: "Checking before the scan",
      gaps: [],
      origin: { icon: null },
    });
    expect(run?.card.origin.text).toMatch(/^Started here at \d\d:\d\d$/);
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
    expect(second?.card.head).toBe("Checking before the scan");
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
});
