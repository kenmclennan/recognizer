import { describe, expect, it } from "vitest";
import type { FreshnessModel } from "../../src/freshness-text";
import type { ScanTicks } from "../../src/scan-panel-model";
import {
  type CoreOutcome,
  type CoreStreamItem,
  createScanSource,
  outcomeResult,
  unavailableResult,
} from "../../src/scan-source";
import { plannedRun } from "../fixtures";

const MODEL = {
  rows: [],
  gaps: new Map<string, string[]>(),
  update: [],
  action: { primary: { label: "Up to date" } },
} as unknown as FreshnessModel;

const ROWS = [
  { name: "structure", runsTests: false, scoped: false },
  { name: "crap", runsTests: true, scoped: false },
];

function ticksOf(overrides: Partial<ScanTicks>): ScanTicks {
  return {
    describe: false,
    analysis: true,
    ticked: [],
    armed: [],
    onlyView: false,
    suites: {},
    folds: [],
    ...overrides,
  };
}

const REPOSITORY = "/work/repo";
const GAP = { id: "crap", line: "crap needs coverage", needs: ["coverage"] };
const IDLE = { running: false, repository: REPOSITORY };

function stubbed(
  replies: Record<string, unknown>,
  items: (op: string) => CoreStreamItem[] = () => [],
) {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const handlers: ((event: { payload: CoreStreamItem }) => void)[] = [];
  const source = createScanSource({
    repository: () => REPOSITORY,
    windowLabel: () => "w-1",
    invoke: async <T>(command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args });

      const op = String(args.op);

      queueMicrotask(() => {
        for (const item of items(op)) {
          for (const handler of handlers) {
            handler({ payload: item });
          }
        }
      });

      return replies[op] as T;
    },
    listen: async <T>(
      _event: string,
      handler: (event: { payload: T }) => void,
    ) => {
      handlers.push(
        handler as unknown as (event: { payload: CoreStreamItem }) => void,
      );

      return () => {};
    },
  });

  return { source, calls };
}

describe("scan source", () => {
  it("the outcome maps to each scan run result", () => {
    const rows: [CoreOutcome, ReturnType<typeof outcomeResult>][] = [
      [{ status: "finished" }, { status: "finished", exitCode: 0 }],
      [
        { status: "failed", reason: "phases" },
        { status: "finished", exitCode: 1 },
      ],
      [
        { status: "failed", reason: "invalid-request", messages: ["a", "b"] },
        { status: "refused", reason: "a\nb" },
      ],
      [
        {
          status: "failed",
          reason: "crashed",
          error: { name: "Error", message: "boom" },
        },
        { status: "failed", exitCode: -1, stderr: "boom" },
      ],
      [{ status: "stopped" }, { status: "stopped" }],
    ];

    for (const [outcome, expected] of rows) {
      expect(outcomeResult(outcome, IDLE)).toEqual(expected);
    }
  });

  it("a phases failure is finished with exit one", () => {
    expect(outcomeResult({ status: "failed", reason: "phases" }, IDLE)).toEqual(
      { status: "finished", exitCode: 1 },
    );
  });

  it("a stopped outcome is stopped and only finished is exit zero", () => {
    expect(outcomeResult({ status: "stopped" }, IDLE)).toEqual({
      status: "stopped",
    });
    expect(outcomeResult({ status: "finished" }, IDLE)).toEqual({
      status: "finished",
      exitCode: 0,
    });
  });

  it("an input error is failed with exit two and a missing service is command missing", () => {
    expect(
      outcomeResult(
        {
          status: "failed",
          reason: "crashed",
          error: { name: "InputError", message: "bad sensor" },
        },
        IDLE,
      ),
    ).toEqual({ status: "failed", exitCode: 2, stderr: "bad sensor" });
    expect(
      unavailableResult({ kind: "missing", hint: "install recognizer" }),
    ).toEqual({ status: "command-missing", hint: "install recognizer" });
  });

  it("a refused preflight is gaps when it has gaps and failed with exit four when not", () => {
    expect(
      outcomeResult(
        { status: "refused", reason: "preflight", gaps: [GAP] },
        IDLE,
      ),
    ).toEqual({ status: "gaps", gaps: [GAP] });
    expect(
      outcomeResult({ status: "refused", reason: "preflight" }, IDLE),
    ).toEqual({ status: "failed", exitCode: 4, stderr: "" });
    expect(unavailableResult({ kind: "gaps", gaps: [GAP] })).toEqual({
      status: "gaps",
      gaps: [GAP],
    });
    expect(unavailableResult({ kind: "refused", reason: "no" })).toEqual({
      status: "refused",
      reason: "no",
    });
    expect(
      unavailableResult({ kind: "exited", status: "exit 1", stderr: "oops" }),
    ).toEqual({ status: "failed", exitCode: -1, stderr: "exit 1\noops" });
  });

  it("a refused lock is attached while the repository is running and refused when it is not", () => {
    const lock: CoreOutcome = { status: "refused", reason: "lock" };

    expect(outcomeResult(lock, { ...IDLE, running: true })).toEqual({
      status: "attached",
    });
    expect(outcomeResult(lock, IDLE)).toEqual({
      status: "refused",
      reason: `a scan is already running on ${REPOSITORY}`,
    });
  });

  it("a run starts the scan, waits for its outcome and maps it", async () => {
    const { source, calls } = stubbed({ "scan.start": "s1" }, (op) =>
      op === "scan.start"
        ? [
            { stream: "s1", event: { kind: "phase" } },
            { stream: "s1", outcome: { status: "finished" } },
          ]
        : [],
    );
    const result = await source.run({
      describe: true,
      describeAll: false,
      analysis: true,
      sense: ["crap"],
      modules: null,
    });

    expect(result).toEqual({ status: "finished", exitCode: 0 });
    expect(calls.find(({ args }) => args.op === "scan.start")).toEqual({
      command: "core_call",
      args: {
        op: "scan.start",
        args: {
          describe: "stale",
          analysis: true,
          sense: ["crap"],
          modules: null,
          suites: undefined,
        },
      },
    });
  });

  it("a rescan with Descriptions unticked starts the scan with describe false", async () => {
    const planned = plannedRun(
      MODEL,
      "rescan",
      ticksOf({ describe: false, ticked: ["structure"] }),
      ROWS,
      null,
      [],
    );

    expect(planned.plan.describe).toBe(false);
    expect(planned.plan.describeAll).toBe(true);

    const { source, calls } = stubbed({ "scan.start": "s1" }, (op) =>
      op === "scan.start"
        ? [{ stream: "s1", outcome: { status: "finished" } }]
        : [],
    );

    await source.run(planned.plan);

    const start = calls.find(({ args }) => args.op === "scan.start");

    expect(
      (start?.args.args as { describe: unknown } | undefined)?.describe,
    ).toBe(false);
  });

  it("a rescan with Descriptions ticked starts the scan with describe all", async () => {
    const planned = plannedRun(
      MODEL,
      "rescan",
      ticksOf({ describe: true }),
      ROWS,
      null,
      [],
    );

    expect(planned.plan.describe).toBe(true);
    expect(planned.plan.describeAll).toBe(true);

    const { source, calls } = stubbed({ "scan.start": "s1" }, (op) =>
      op === "scan.start"
        ? [{ stream: "s1", outcome: { status: "finished" } }]
        : [],
    );

    await source.run(planned.plan);

    const start = calls.find(({ args }) => args.op === "scan.start");

    expect(
      (start?.args.args as { describe: unknown } | undefined)?.describe,
    ).toBe("all");
  });

  it("an unavailable reply becomes the matching result", async () => {
    const { source } = stubbed({
      "scan.start": { unavailable: { kind: "missing", hint: "install it" } },
    });

    expect(
      await source.run({
        describe: false,
        describeAll: false,
        analysis: true,
        sense: [],
        modules: null,
      }),
    ).toEqual({ status: "command-missing", hint: "install it" });
  });

  it("a plan is asked of the service with the request", async () => {
    const view = { intent: {}, gaps: {}, never: [] };
    const { source, calls } = stubbed({ "scan.plan": view });
    const request = {
      repository: ".",
      mode: "bring" as const,
      ticks: {
        describe: false,
        analysis: true,
        ticked: [],
        armed: [],
        onlyView: false,
        suites: {},
        folds: [],
      },
      scope: null,
      changed: [],
    };

    expect(await source.plan(request)).toEqual(view);
    expect(calls[0]?.args).toEqual({ op: "scan.plan", args: request });
  });

  it("a_scan_in_one_window_leaves_the_other_windows_state_untouched", async () => {
    const bus: ((event: { payload: CoreStreamItem }) => void)[] = [];
    const sourceFor = (label: string) =>
      createScanSource({
        repository: () => REPOSITORY,
        windowLabel: () => label,
        invoke: async <T>() => null as T,
        listen: async <T>(
          _event: string,
          handler: (event: { payload: T }) => void,
        ) => {
          bus.push(
            handler as unknown as (event: { payload: CoreStreamItem }) => void,
          );

          return () => {};
        },
      });
    const one = sourceFor("w-1");
    const two = sourceFor("w-2");
    const seenByOne: unknown[] = [];
    const seenByTwo: unknown[] = [];

    one.onRun((event) => seenByOne.push(event));
    two.onRun((event) => seenByTwo.push(event));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const run = {
      version: 1,
      run_id: "r",
      phase: "running",
    } as unknown as Extract<CoreStreamItem, { run: unknown }>["run"];
    const deliver = (item: CoreStreamItem) => {
      for (const handler of bus) {
        handler({ payload: item });
      }
    };

    deliver({ stream: "w1", window: "w-2", run });
    deliver({ stream: "w1", window: "w-2", line: "Coverage run: unit" });

    expect(seenByOne).toEqual([]);
    expect(seenByTwo).toEqual([
      { kind: "run", run },
      { kind: "line", line: "Coverage run: unit" },
    ]);
  });
});
