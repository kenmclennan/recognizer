import { Repository } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { stopEverything } from "../src/cli.js";
import { runSensors } from "../src/run-sensors.js";
import { repositoryFrom } from "./repository-from.js";
import {
  COMMIT,
  event,
  pluginCommand,
  pluginFile,
  setup,
  stagingOnly,
} from "./run-sensors-plugin.js";

const DIAGNOSIS = {
  code: "tool-missing",
  line: "cargo-llvm-cov is not installed; install it with cargo install cargo-llvm-cov",
  fix: "cargo install cargo-llvm-cov",
};

const diagnosisEvent = (value: { code: string; line: string; fix?: string }) =>
  event({
    event: "diagnosis",
    code: value.code,
    text: value.line,
    ...(value.fix === undefined ? {} : { fix: value.fix }),
  });

const WRITES_DIAGNOSIS = (diagnosis: unknown) => `
const fs = require("fs");
fs.mkdirSync(require("path").dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({
  findings_version: 1,
  sensor: { name: "quick", version: "1" },
  commit,
  modified: false,
  settings: {},
  findings: [],
  diagnosis: ${JSON.stringify(diagnosis)},
}));
`;

describe("runSensors diagnosis", () => {
  for (const runsTests of [false, true]) {
    it(`carries a refusal's diagnosis event to the entry and keeps the plain line as the reason (runsTests ${runsTests})`, async () => {
      const { root, io } = setup();
      const refusing = pluginFile(
        root,
        `${diagnosisEvent(DIAGNOSIS)}
process.stderr.write(${JSON.stringify(DIAGNOSIS.line)} + "\\n");
process.exit(2);`,
      );
      const [entry] = await runSensors({
        io,
        findings: stagingOnly(),
        root,
        commit: COMMIT,
        repository: Repository.empty,
        selected: [
          { name: "quick", runsTests, command: pluginCommand(refusing) },
        ],
      });

      expect(entry?.diagnosis).toEqual(DIAGNOSIS);
      expect(entry?.reason).toBe(DIAGNOSIS.line);
      expect(entry?.stderr).not.toContain("recognizer-event");
    });
  }

  it("carries the findings document's diagnosis on a run that exits zero", async () => {
    const { root, io } = setup();
    const writing = pluginFile(
      root,
      WRITES_DIAGNOSIS({
        code: "tests-failed",
        line: "3 tests failed, so coverage may read low",
        failing: { count: 3, names: ["a", "b", "c"] },
      }),
    );
    const [entry] = await runSensors({
      io,
      findings: stagingOnly(),
      root,
      commit: COMMIT,
      repository: Repository.empty,
      selected: [{ name: "quick", command: pluginCommand(writing) }],
    });

    expect(entry).toMatchObject({
      outcome: "ok",
      diagnosis: { code: "tests-failed", failing: { count: 3 } },
    });
  });

  it("fails a non-zero exit with no diagnosis event with its stderr as the reason", async () => {
    const { root, io } = setup();
    const refusing = pluginFile(
      root,
      `process.stderr.write("plain reason\\n");\nprocess.exit(2);`,
    );
    const [entry] = await runSensors({
      io,
      findings: stagingOnly(),
      root,
      commit: COMMIT,
      repository: Repository.empty,
      selected: [{ name: "quick", command: pluginCommand(refusing) }],
    });

    expect(entry).toMatchObject({ outcome: "failed", reason: "plain reason" });
    expect(entry?.diagnosis).toBeUndefined();
  });

  it("records an entry stopped by the user as stopped, not failed, and prints no failure line", async () => {
    const { root, io, messages } = setup();
    const noisy = pluginFile(
      root,
      `
      process.on("SIGTERM", () => {
        process.stderr.write("workers: 8\\n");
        process.exit(143);
      });
      ${event({ event: "note", text: "mutating" })}
      setInterval(() => {}, 1000);
    `,
    );
    const running = runSensors({
      io,
      findings: stagingOnly(),
      root,
      commit: COMMIT,
      repository: Repository.empty,
      selected: [{ name: "quick", command: pluginCommand(noisy) }],
      onEvent: () => {
        void stopEverything();
      },
    });
    const [entry] = await running;

    expect(entry).toMatchObject({ outcome: "stopped", reason: "stopped" });
    expect(messages.join("")).not.toContain("failed quick");
  });

  for (const code of ["tests-failed", "anything-at-all"]) {
    it(`keeps an exit-zero entry ok when its document's diagnosis is ${code} with no unmeasured flag`, async () => {
      const { root, io } = setup();
      const diagnosis = {
        code,
        line: "3 tests failed, so coverage may read low",
      };
      const writing = pluginFile(root, WRITES_DIAGNOSIS(diagnosis));
      const [entry] = await runSensors({
        io,
        findings: stagingOnly(),
        root,
        commit: COMMIT,
        repository: Repository.empty,
        selected: [{ name: "quick", command: pluginCommand(writing) }],
      });

      expect(entry).toMatchObject({ outcome: "ok", diagnosis });
    });
  }

  for (const code of [
    "tool-missing",
    "coverage-unavailable",
    "anything-at-all",
  ]) {
    it(`fails an exit-zero sensor whose diagnosis is ${code} with the diagnosis line as the reason`, async () => {
      const { root, io } = setup();
      const diagnosis = {
        code,
        line: "coverage and pytest are not installed",
        fix: "uv sync",
        unmeasured: true,
      };
      const writing = pluginFile(root, WRITES_DIAGNOSIS(diagnosis));
      const [entry] = await runSensors({
        io,
        findings: stagingOnly(),
        root,
        commit: COMMIT,
        repository: Repository.empty,
        selected: [{ name: "quick", command: pluginCommand(writing) }],
      });

      expect(entry).toMatchObject({
        outcome: "failed",
        reason: diagnosis.line,
        diagnosis,
      });
    });
  }

  for (const [label, line] of [
    ["not valid JSON", "recognizer-event {nope"],
    [
      "an extra key",
      `recognizer-event ${JSON.stringify({ event: "diagnosis", code: "x", text: "y", extra: 1 })}`,
    ],
    [
      "an empty text",
      `recognizer-event ${JSON.stringify({ event: "diagnosis", code: "x", text: "" })}`,
    ],
  ] as const) {
    it(`drops an invalid diagnosis event that is ${label} and gives no diagnosis`, async () => {
      const { root, io } = setup();
      const refusing = pluginFile(
        root,
        `process.stderr.write(${JSON.stringify(line)} + "\\n");\nprocess.stderr.write("plain\\n");\nprocess.exit(2);`,
      );
      const [entry] = await runSensors({
        io,
        findings: stagingOnly(),
        root,
        commit: COMMIT,
        repository: Repository.empty,
        selected: [{ name: "quick", command: pluginCommand(refusing) }],
      });

      expect(entry?.diagnosis).toBeUndefined();
      expect(entry?.stderr).toContain("plain");
      expect(entry?.stderr).toContain("ignored 1 invalid event line");
    });
  }
});

describe("sense entry figures", () => {
  const scans = repositoryFrom([
    {
      modules: [{ id: "a.py" }, { id: "b.py" }, { id: "c.py" }],
      files: [],
    },
  ]);
  const finishing = (extra: string) => `
    const fs = require("fs");
    fs.mkdirSync(require("path").dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({
      findings_version: 1,
      sensor: { name: "quick", version: "1" },
      commit, modified: false, settings: {}, findings: [], ${extra}
    }));
  `;

  async function sensed(
    script: string,
    over: {
      runsTests?: boolean;
      modules?: number;
      clock?: number[];
      wall?: () => number;
    } = {},
  ) {
    const { root, io } = setup();
    const steps = over.clock ?? [];
    let at = 0;
    const reading = () =>
      steps.length > 0
        ? (steps[Math.min(at, steps.length - 1)] as number)
        : Date.now();
    const ticking = {
      ...io,
      now: over.wall ?? reading,
      awake: reading,
    };
    const [entry] = await runSensors({
      io: ticking,
      root,
      commit: COMMIT,
      repository: scans,
      selected: [
        {
          name: "quick",
          ...(over.runsTests === undefined
            ? {}
            : { runsTests: over.runsTests }),
          ...(over.modules === undefined ? {} : { modules: over.modules }),
          command: pluginCommand(pluginFile(root, script)),
        },
      ],
      onEvent: () => {
        at += 1;
      },
    });

    return entry;
  }

  it("records fixed_ms as the delta to the first progress event with done above 0 and the cached module count", async () => {
    const entry = await sensed(
      `${event({ event: "start", total: 3, unit: "functions" })}
${event({ event: "progress", done: 0, total: 3, unit: "functions" })}
${event({ event: "progress", done: 1, total: 3, unit: "functions" })}
${finishing("")}`,
      { runsTests: true, clock: [0, 1000, 9000, 20000] },
    );

    expect(entry).toMatchObject({
      outcome: "ok",
      modules: 3,
      fixed_ms: 9000,
      duration_ms: 20000,
    });
  });

  it("records each suite's own duration from the suite progress events", async () => {
    const stage = (index: number, name: string) =>
      event({ event: "stage", name, index, of: 2 });
    const entry = await sensed(
      `${event({ event: "start", total: 2, unit: "suites" })}
${stage(1, "engine")}
${stage(2, "app")}
${finishing("")}`,
      { clock: [0, 0, 3000, 9000] },
    );

    expect(entry?.suites).toEqual([
      { name: "engine", duration_ms: 3000 },
      { name: "app", duration_ms: 6000 },
    ]);
  });

  it("records no suites for a run with no stage events", async () => {
    const entry = await sensed(finishing(""));

    expect(entry).not.toHaveProperty("suites");
  });

  it("a run-log duration ignores an injected sleep gap", async () => {
    const HOURS_8 = 8 * 3_600_000;
    let wall = 0;
    const entry = await sensed(
      `${event({ event: "start", total: 3, unit: "functions" })}
${event({ event: "progress", done: 0, total: 3, unit: "functions" })}
${event({ event: "progress", done: 1, total: 3, unit: "functions" })}
${finishing("")}`,
      {
        runsTests: true,
        clock: [0, 1000, 9000, 20000],
        wall: () => {
          wall += HOURS_8;

          return wall;
        },
      },
    );

    expect(entry).toBeDefined();
    expect(entry).toMatchObject({ fixed_ms: 9000, duration_ms: 20000 });
  });

  it("records the whole duration as fixed_ms when no progress event arrives", async () => {
    const entry = await sensed(
      `${event({ event: "start", total: 3, unit: "functions" })}\n${finishing("")}`,
      { runsTests: true, clock: [0, 7000, 7000] },
    );

    expect(entry?.fixed_ms).toBe(entry?.duration_ms);
    expect(entry?.duration_ms).toBe(7000);
  });

  it("gives a sensor that runs no tests no fixed_ms", async () => {
    const entry = await sensed(finishing(""));

    expect(entry).toMatchObject({ outcome: "ok", modules: 3 });
    expect(entry).not.toHaveProperty("fixed_ms");
  });

  it("records the scoped module count when one was given", async () => {
    const entry = await sensed(finishing(""), { runsTests: true, modules: 2 });

    expect(entry?.modules).toBe(2);
  });

  const suite = (
    status: string,
    measured: number,
    total: number,
    ran?: boolean,
  ) =>
    `{ name: "s", status: "${status}", ran_at: "2026-01-01T00:00:00Z", measured: ${measured}, total: ${total}${ran === undefined ? "" : `, ran: ${ran}`} }`;

  it.each([
    ["stopped", "stopped: { measured: 3, total: 10 }"],
    ["a partial suite", `suites: [${suite("partial", 3, 10)}]`],
  ])(
    "records incomplete for a findings document carrying %s",
    async (_name, extra) => {
      const entry = await sensed(finishing(extra));

      expect(entry?.incomplete).toBe(true);
    },
  );

  it("records incomplete for a partial suite the run ticked", async () => {
    const entry = await sensed(
      finishing(`suites: [${suite("partial", 3, 10, true)}]`),
    );

    expect(entry?.incomplete).toBe(true);
  });

  it("records no incomplete key for a partial suite the run did not tick beside an ok one it did", async () => {
    const entry = await sensed(
      finishing(
        `suites: [${suite("ok", 3, 3, true)}, ${suite("partial", 1, 3, false)}]`,
      ),
    );

    expect(entry?.outcome).toBe("ok");
    expect(entry).not.toHaveProperty("incomplete");
  });

  it("records the work a findings document carries, without the reused count", async () => {
    const entry = await sensed(
      finishing('work: { unit: "functions", performed: 4, reused: 9 }'),
    );

    expect(entry?.work).toEqual({ unit: "functions", performed: 4 });
  });

  it("records no work key for a document without one", async () => {
    const entry = await sensed(finishing(""));

    expect(entry).not.toHaveProperty("work");
  });

  it("records no incomplete key for a document whose partial key covers functions outside its scope", async () => {
    const entry = await sensed(
      finishing(
        `partial: { measured: 3, total: 10 }, counts: { measured: 3, total: 10 }, suites: [${suite("ok", 3, 3)}]`,
      ),
    );

    expect(entry).toBeDefined();
    expect(entry?.outcome).toBe("ok");
    expect(entry).not.toHaveProperty("incomplete");
  });

  it("records incomplete when any one of several suites is partial", async () => {
    const entry = await sensed(
      finishing(`suites: [${suite("ok", 3, 3)}, ${suite("partial", 1, 3)}]`),
    );

    expect(entry?.incomplete).toBe(true);
  });

  it("records incomplete for a stopped document that lists no suites", async () => {
    const entry = await sensed(
      finishing("stopped: { measured: 0, total: 10 }"),
    );

    expect(entry?.incomplete).toBe(true);
  });

  it("carries no incomplete key for a document with neither", async () => {
    const entry = await sensed(finishing(""));

    expect(entry).not.toHaveProperty("incomplete");
  });
});
