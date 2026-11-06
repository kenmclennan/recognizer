import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import type { Io, Running, RunResult } from "../src/cli.js";
import {
  type DescribeResult,
  describeModules,
  describeSummaryText,
} from "../src/describe-modules.js";
import type { Scan } from "../src/scan.js";
import { capture, REPO } from "./helpers.js";

const scan = JSON.parse(
  readFileSync(join(REPO, "fixtures/python/expected-scan.json"), "utf8"),
) as Scan;
const IDS = scan.modules.map((module) => module.id).sort();

type Outcome = "ok" | "fail" | "limit" | "hold";

interface Call {
  module: string;
  killed: boolean;
  settle: (outcome: "ok" | "fail" | "limit") => void;
}

function result(status: number, stdout: string, stderr: string): RunResult {
  return { started: true, status, stdout, stderr } as RunResult;
}

function harness(
  script: (module: string, index: number) => Outcome,
  stubborn: number[] = [],
) {
  const root = makeTempDir("recognizer-describe-stop-");

  cpSync(join(REPO, "fixtures/python/sample"), root, { recursive: true });

  const calls: Call[] = [];
  const out = capture();
  const outcomes = (module: string): RunResult[] => [
    result(0, `describes ${module}\n`, ""),
    result(1, "", `cannot describe ${module}`),
    result(75, "", "claude usage limit: Claude usage limit reached"),
  ];

  const io: Io = {
    ...out.io,
    runAsync: (_command, args) => {
      const module = JSON.parse(
        readFileSync(args[args.length - 1] as string, "utf8"),
      ).module as string;
      const index = calls.length;
      let finish: (value: RunResult) => void = () => {};
      const pending = new Promise<RunResult>((resolve) => {
        finish = resolve;
      });
      const call: Call = {
        module,
        killed: false,
        settle: (outcome) =>
          finish(
            outcomes(module)[
              outcome === "ok" ? 0 : outcome === "fail" ? 1 : 2
            ] as RunResult,
          ),
      };

      calls.push(call);

      const planned = script(module, index);

      if (planned !== "hold") {
        queueMicrotask(() => call.settle(planned));
      }

      const running: Running = {
        result: pending,
        kill: () => {
          call.killed = true;

          if (!stubborn.includes(index)) {
            finish(result(143, "", ""));
          }
        },
      };

      return running;
    },
  };

  return { root, io, calls };
}

function run(
  box: ReturnType<typeof harness>,
  batchSize: number,
): Promise<DescribeResult> {
  return describeModules({
    io: box.io,
    root: box.root,
    scans: [scan],
    describer: {
      command: ["describer", "{request}"],
      version: "v1",
    },
    selection: { kind: "all" },
    model: "haiku",
    batchSize,
  });
}

describe("limit stop", () => {
  it("stops launching, kills the running calls and lists what was not described", async () => {
    const box = harness((_module, index) => (index === 0 ? "limit" : "hold"));
    const finished = run(box, 4);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const outcome = await finished;

    expect(box.calls).toHaveLength(4);
    expect(box.calls.slice(1).every((call) => call.killed)).toBe(true);
    expect(outcome.stopped?.cause).toBe("limit");
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]?.module).toBe(box.calls[0]?.module);
    expect(outcome.stopped?.module).toBe(box.calls[0]?.module);
    expect(outcome.described).toEqual([]);
    expect(outcome.stopped?.not_described).toEqual(
      IDS.filter((id) => id !== box.calls[0]?.module),
    );
  });

  it("keeps the lines written before the limit and starts nothing after it", async () => {
    const box = harness((_module, index) =>
      index < 2 ? "ok" : index === 2 ? "limit" : "hold",
    );
    const outcome = await run(box, 1);
    const written = JSON.parse(
      readFileSync(join(box.root, ".recognizer/responsibilities.json"), "utf8"),
    ).modules;

    expect(box.calls.map((call) => call.module)).toEqual(IDS.slice(0, 3));
    expect(outcome.described).toEqual(IDS.slice(0, 2));
    expect(outcome.failed.map((one) => one.module)).toEqual([IDS[2]]);
    expect(outcome.stopped?.not_described).toEqual(IDS.slice(3));
    expect(Object.keys(written).sort()).toEqual(IDS.slice(0, 2));
    expect(written[IDS[0] as string].version).toBe("v1");
  });

  it("writes a call that succeeds after the stop and drops one that fails", async () => {
    const box = harness(
      (_module, index) => (index === 0 ? "limit" : "hold"),
      [1],
    );
    const finished = run(box, 3);

    await new Promise((resolve) => setTimeout(resolve, 20));
    box.calls[1]?.settle("ok");

    const outcome = await finished;

    expect(outcome.described).toContain(box.calls[1]?.module);
    expect(outcome.failed).toHaveLength(1);
  });

  it("says so in the summary", async () => {
    const box = harness((_module, index) => (index === 0 ? "limit" : "ok"));
    const outcome = await run(box, 1);

    expect(describeSummaryText(outcome)).toBe(
      `stopped: claude usage limit reached (claude usage limit: Claude usage limit reached); described 0, failed 1, not described ${IDS.length - 1}, already current 0\n`,
    );
  });
});

describe("consecutive failure stop", () => {
  it("stops on the failure that reaches a whole batch", async () => {
    const box = harness(() => "fail");
    const outcome = await run(box, 4);

    expect(box.calls).toHaveLength(4);
    expect(outcome.stopped?.cause).toBe("failures");
    expect(outcome.stopped?.threshold).toBe(4);
    expect(outcome.failed).toHaveLength(4);
    expect(outcome.stopped?.not_described).toHaveLength(IDS.length - 4);
    expect(describeSummaryText(outcome)).toContain(
      "stopped: 4 describer calls failed in a row (last: cannot describe",
    );
  });

  it("resets the count on a written line", async () => {
    const pattern: Outcome[] = [
      "fail",
      "fail",
      "fail",
      "ok",
      "fail",
      "fail",
      "fail",
    ];
    const box = harness((_module, index) => pattern[index] ?? "ok");
    const outcome = await run(box, 1);
    const stopsAtTwo = outcome.stopped;

    expect(stopsAtTwo?.threshold).toBe(2);

    const wide = harness((_module, index) => pattern[index] ?? "ok");
    const result = await run(wide, 4);

    expect(result.stopped).toBeNull();
    expect(wide.calls).toHaveLength(IDS.length);
  });

  it("holds a batch size of 1 to two failures in a row", async () => {
    const one = harness((_module, index) => (index === 0 ? "fail" : "ok"));
    const outcome = await run(one, 1);

    expect(outcome.stopped).toBeNull();
    expect(one.calls).toHaveLength(IDS.length);

    const two = harness((_module, index) => (index < 2 ? "fail" : "ok"));
    const stopped = await run(two, 1);

    expect(stopped.stopped?.cause).toBe("failures");
    expect(two.calls).toHaveLength(2);
  });

  it("calls a first failure with status 75 a limit", async () => {
    const box = harness((_module, index) => (index === 0 ? "limit" : "ok"));

    expect((await run(box, 4)).stopped?.cause).toBe("limit");
  });

  it("does not count a call the stop killed", async () => {
    const box = harness((_module, index) => (index === 0 ? "limit" : "hold"));
    const finished = run(box, 4);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((await finished).failed).toHaveLength(1);
  });
});
