import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";
import { repositoryFrom } from "./repository-from.js";

import {
  type CliScenario,
  cliScenario,
  type Program,
  type RunResult,
} from "./support/index.js";
import {
  describerManifestText,
  scannerManifestText,
} from "./support/manifest-text.js";

const scanText = readFileSync(
  join(REPO, "fixtures/python/expected-scan.json"),
  "utf8",
);
const scan = repositoryFrom(JSON.parse(scanText));
const IDS = scan.files.map((file) => file.path).sort();

const APP_CONFIG = "/app-config";
const REPOSITORY = "/repo";

type Outcome = "ok" | "fail" | "limit" | "hold";

interface Call {
  module: string;
  killed: boolean;
  settle: (outcome: "ok" | "fail" | "limit") => void;
}

function result(status: number, stdout: string, stderr: string): RunResult {
  return { started: true, status, stdout, stderr } as RunResult;
}

interface Result {
  described: string[];
  failed: { module: string }[];
  stopped: {
    cause: string;
    module?: string;
    threshold?: number;
    not_described: string[];
  } | null;
}

function harness(
  script: (module: string, index: number) => Outcome,
  stubborn: number[] = [],
) {
  const calls: Call[] = [];
  const outcomes = (module: string): RunResult[] => [
    result(0, `describes ${module}\n`, ""),
    result(1, "", `cannot describe ${module}`),
    result(75, "", "claude usage limit: Claude usage limit reached"),
  ];

  const describer: Program = (call) => {
    if (call.args[call.args.length - 1] === "manifest") {
      return result(0, describerManifestText("v1"), "");
    }

    const module = JSON.parse(
      call.files.readFile(call.args[call.args.length - 1] as string),
    ).module as string;
    const index = calls.length;
    let finish: (value: RunResult) => void = () => {};
    const pending = new Promise<RunResult>((resolve) => {
      finish = resolve;
    });
    const entry: Call = {
      module,
      killed: false,
      settle: (outcome) =>
        finish(
          outcomes(module)[
            outcome === "ok" ? 0 : outcome === "fail" ? 1 : 2
          ] as RunResult,
        ),
    };

    calls.push(entry);

    if (stubborn.includes(index)) {
      call.survivesKill = true;
    }

    void call.whenKilled().then(() => {
      entry.killed = true;

      if (!stubborn.includes(index)) {
        finish(result(143, "", ""));
      }
    });

    const planned = script(module, index);

    if (planned !== "hold") {
      queueMicrotask(() => entry.settle(planned));
    }

    return pending;
  };

  const scenario = cliScenario({
    sample: false,
    repository: REPOSITORY,
    env: { RECOGNIZER_APP_CONFIG_DIR: APP_CONFIG },
    programs: {
      "recognizer-describe-stop": describer,
      "recognizer-scan-python": (call) => ({
        started: true,
        status: 0,
        stdout:
          call.args[0] === "manifest" ? scannerManifestText("python") : "",
        stderr: "",
      }),
    },
  });

  scenario.root.io.files.seedFrom(
    join(REPO, "fixtures/python/sample"),
    REPOSITORY,
  );
  scenario.root.io.files.writeFile(
    `${REPOSITORY}/.gitignore`,
    ".recognizer/cache/\n",
  );
  scenario.root.io.files.writeFile(
    `${REPOSITORY}/.recognizer/config.yaml`,
    'describer:\n  command: ["recognizer-describe-stop", "run", "{request}"]\n  version: "v1"\n',
  );

  const commit = scenario.root.repositories.commitAll(REPOSITORY, "sample");
  const cached = JSON.parse(scanText);

  cached.commit = commit;
  cached.modified = false;
  scenario.root.io.files.writeFile(
    `${REPOSITORY}/.recognizer/cache/scan.python.json`,
    JSON.stringify(cached),
  );

  return { scenario, calls };
}

function run(
  box: ReturnType<typeof harness>,
  batchSize: number,
): Promise<{ parsed: Result; text: string }> {
  box.scenario.root.io.files.writeFile(
    `${APP_CONFIG}/config.json`,
    JSON.stringify({ describing: { model: "haiku", batch_size: batchSize } }),
  );

  return box.scenario
    .run(["describe", "--all", "--json", "--repository", REPOSITORY])
    .then((outcome) => ({
      parsed: JSON.parse(outcome.out) as Result,
      text: outcome.out,
    }));
}

function summary(box: ReturnType<typeof harness>): Promise<string> {
  return box.scenario
    .run(["describe", "--all", "--repository", REPOSITORY])
    .then((outcome) => outcome.out);
}

function written(scenario: CliScenario): Record<string, { version: string }> {
  return scenario.readJson<{ modules: Record<string, { version: string }> }>(
    ".recognizer/responsibilities.json",
  ).modules;
}

describe("limit stop", () => {
  it("stops launching, kills the running calls and lists what was not described", async () => {
    const box = harness((_module, index) => (index === 0 ? "limit" : "hold"));
    const { parsed } = await run(box, 4);

    expect(box.calls).toHaveLength(4);
    expect(box.calls.slice(1).every((call) => call.killed)).toBe(true);
    expect(parsed.stopped?.cause).toBe("limit");
    expect(parsed.failed).toHaveLength(1);
    expect(parsed.failed[0]?.module).toBe(box.calls[0]?.module);
    expect(parsed.stopped?.module).toBe(box.calls[0]?.module);
    expect(parsed.described).toEqual([]);
    expect(parsed.stopped?.not_described).toEqual(
      IDS.filter((id) => id !== box.calls[0]?.module),
    );
  });

  it("keeps the lines written before the limit and starts nothing after it", async () => {
    const box = harness((_module, index) =>
      index < 2 ? "ok" : index === 2 ? "limit" : "hold",
    );
    const { parsed } = await run(box, 1);
    const modules = written(box.scenario);

    expect(box.calls.map((call) => call.module)).toEqual(IDS.slice(0, 3));
    expect(parsed.described).toEqual(IDS.slice(0, 2));
    expect(parsed.failed.map((one) => one.module)).toEqual([IDS[2]]);
    expect(parsed.stopped?.not_described).toEqual(IDS.slice(3));
    expect(Object.keys(modules).sort()).toEqual(IDS.slice(0, 2));
    expect(modules[IDS[0] as string]?.version).toBe("v1");
  });

  it("writes a call that succeeds after the stop and drops one that fails", async () => {
    const box = harness(
      (_module, index) => (index === 0 ? "limit" : "hold"),
      [1],
    );
    const finished = run(box, 3);

    await box.scenario.root.settle();
    box.calls[1]?.settle("ok");

    const { parsed } = await finished;

    expect(parsed.described).toContain(box.calls[1]?.module);
    expect(parsed.failed).toHaveLength(1);
  });

  it("says so in the summary", async () => {
    const box = harness((_module, index) => (index === 0 ? "limit" : "ok"));

    box.scenario.root.io.files.writeFile(
      `${APP_CONFIG}/config.json`,
      JSON.stringify({ describing: { model: "haiku", batch_size: 1 } }),
    );

    const text = await summary(box);

    expect(
      text.endsWith(
        `stopped: claude usage limit reached (claude usage limit: Claude usage limit reached); described 0, failed 1, not described ${IDS.length - 1}, already current 0\n`,
      ),
    ).toBe(true);
  });
});

describe("consecutive failure stop", () => {
  it("stops on the failure that reaches a whole batch", async () => {
    const box = harness(() => "fail");
    const { parsed } = await run(box, 4);

    expect(box.calls).toHaveLength(4);
    expect(parsed.stopped?.cause).toBe("failures");
    expect(parsed.stopped?.threshold).toBe(4);
    expect(parsed.failed).toHaveLength(4);
    expect(parsed.stopped?.not_described).toHaveLength(IDS.length - 4);

    const text = await summary(box);

    expect(text).toContain(
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
    const { parsed } = await run(box, 1);

    expect(parsed.stopped?.threshold).toBe(2);

    const wide = harness((_module, index) => pattern[index] ?? "ok");
    const result = await run(wide, 4);

    expect(result.parsed.stopped).toBeNull();
    expect(wide.calls).toHaveLength(IDS.length);
  });

  it("holds a batch size of 1 to two failures in a row", async () => {
    const one = harness((_module, index) => (index === 0 ? "fail" : "ok"));
    const { parsed } = await run(one, 1);

    expect(parsed.stopped).toBeNull();
    expect(one.calls).toHaveLength(IDS.length);

    const two = harness((_module, index) => (index < 2 ? "fail" : "ok"));
    const stopped = await run(two, 1);

    expect(stopped.parsed.stopped?.cause).toBe("failures");
    expect(two.calls).toHaveLength(2);
  });

  it("calls a first failure with status 75 a limit", async () => {
    const box = harness((_module, index) => (index === 0 ? "limit" : "ok"));

    expect((await run(box, 4)).parsed.stopped?.cause).toBe("limit");
  });

  it("does not count a call the stop killed", async () => {
    const box = harness((_module, index) => (index === 0 ? "limit" : "hold"));
    const { parsed } = await run(box, 4);

    expect(parsed.failed).toHaveLength(1);
  });
});
