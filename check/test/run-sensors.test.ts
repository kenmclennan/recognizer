import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { nodeIo, stopEverything } from "../src/cli.js";
import { validateFindings } from "../src/findings-document.js";
import { runSensors } from "../src/run-sensors.js";
import type { Scan } from "../src/scan.js";

const COMMIT = "abc123";

const WRITES_FINDINGS = `
const fs = require("fs");
const [commit, output] = process.argv.slice(1);
fs.mkdirSync(require("path").dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({
  findings_version: 1,
  sensor: { name: "quick", version: "1" },
  commit,
  modified: false,
  settings: {},
  findings: [],
}));
`;

function manifestOf(extra: Record<string, unknown> = {}) {
  return {
    kind: "sensor",
    name: "quick",
    display: "Quick",
    version: "1",
    protocol: 1,
    install: "brew install --cask kenmclennan/tap/recognizer",
    check: false,
    long_running: true,
    units: ["functions"],
    settings: [],
    metrics: [],
    findings: [],
    runs_tests: false,
    scoped: false,
    ...extra,
  };
}

function pluginFile(
  root: string,
  body: string,
  manifest = manifestOf(),
): string {
  const file = join(root, `plugin-${Math.random().toString(36).slice(2)}.cjs`);

  writeFileSync(
    file,
    `const [verb, ...rest] = process.argv.slice(2);
if (verb === "manifest") {
  process.stdout.write(${JSON.stringify(JSON.stringify(manifest))} + "\\n");
  process.exit(0);
}
const [commit, output] = rest;
${body}
`,
  );

  return file;
}

function pluginCommand(file: string): string[] {
  return [process.execPath, file, "run", "{commit}", "{output}"];
}

function setup() {
  const root = makeTempDir("run-sensors-");
  const messages: string[] = [];
  const io = { ...nodeIo(), stderr: (text: string) => messages.push(text) };

  return { root, io, messages };
}

const FINDINGS_BODY = `
const fs = require("fs");
fs.mkdirSync(require("path").dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({
  findings_version: 1,
  sensor: { name: "quick", version: "1" },
  commit,
  modified: false,
  settings: {},
  findings: [],
}));
`;

const event = (value: Record<string, unknown>) =>
  `process.stderr.write("recognizer-event " + ${JSON.stringify(JSON.stringify(value))} + "\\n");`;

describe("runSensors ceiling", () => {
  it(
    "fails a sensor still running at the ceiling as timed out and runs the next one",
    async () => {
      const { root, io, messages } = setup();
      const entries: string[] = [];
      const hung = pluginFile(
        root,
        "setTimeout(() => {}, 30000);",
        manifestOf({ long_running: false, time_limit_seconds: 1 }),
      );
      const results = await runSensors({
        io,
        root,
        commit: COMMIT,
        scans: [],
        selected: [
          { name: "hung", command: pluginCommand(hung) },
          {
            name: "quick",
            command: [
              process.execPath,
              "-e",
              WRITES_FINDINGS,
              "{commit}",
              "{output}",
            ],
          },
        ],
        onEntry: (entry) => entries.push(entry.name),
      });

      expect(results.map((entry) => entry.name)).toEqual(["hung", "quick"]);
      expect(results[0]).toMatchObject({
        outcome: "failed",
        reason: "timed out",
      });
      expect(results[1]).toMatchObject({ outcome: "ok" });
      expect(entries).toEqual(["hung", "quick"]);
      expect(messages.join("")).toContain("failed hung: timed out");
      expect(
        readFileSync(
          join(root, ".recognizer/cache/findings/quick.json"),
          "utf8",
        ),
      ).toContain('"quick"');
    },
    scaledTimeout(20000),
  );

  it(
    "passes the manifest's limit and the grace to the run and none for a legacy command",
    async () => {
      const { root, messages } = setup();
      const seen: { timeoutMs?: number; graceMs?: number }[] = [];
      const manifests: string[][] = [];
      const real = nodeIo();
      const io = {
        ...real,
        stderr: (text: string) => messages.push(text),
        run: (
          command: string,
          args: string[],
          options?: { cwd?: string; timeoutMs?: number },
        ) => {
          if (args.at(-1) === "manifest") {
            manifests.push([command, ...args]);
          }

          return real.run(command, args, options);
        },
        runAsync: (
          command: string,
          args: string[],
          options?: { cwd?: string; timeoutMs?: number; graceMs?: number },
        ) => {
          seen.push({
            timeoutMs: options?.timeoutMs,
            graceMs: options?.graceMs,
          });

          return real.runAsync(command, args, options);
        },
      };
      const limited = pluginFile(
        root,
        FINDINGS_BODY,
        manifestOf({ long_running: false, time_limit_seconds: 5 }),
      );
      const open = pluginFile(root, FINDINGS_BODY);

      await runSensors({
        io,
        root,
        commit: COMMIT,
        scans: [],
        selected: [
          { name: "quick", command: pluginCommand(limited) },
          { name: "quick", command: pluginCommand(open) },
          { name: "quick", command: ["true"] },
        ],
      });

      expect(seen).toEqual([
        { timeoutMs: 5000, graceMs: 10_000 },
        { timeoutMs: undefined, graceMs: 10_000 },
        { timeoutMs: undefined, graceMs: 10_000 },
      ]);
      expect(manifests).toHaveLength(2);
    },
    scaledTimeout(20000),
  );

  it("hands a plugin event to onEvent while the plugin is still running", async () => {
    const { root, io } = setup();
    const seen: unknown[] = [];
    let release: () => void = () => {};
    const observed = new Promise<void>((done) => {
      release = done;
    });
    const gate = join(root, "gate");
    const live = pluginFile(
      root,
      `
      const fs = require("fs");
      ${event({ event: "note", text: "Coverage run: unit" })}
      const wait = () => fs.existsSync(${JSON.stringify(gate)}) ? finish() : setTimeout(wait, 10);
      const finish = () => {
        ${FINDINGS_BODY}
      };
      wait();
    `,
      manifestOf({ name: "live" }),
    );
    const running = runSensors({
      io,
      root,
      commit: COMMIT,
      scans: [],
      selected: [
        { name: "quick", runsTests: true, command: pluginCommand(live) },
      ],
      onEvent: (name, one) => {
        seen.push({ name, ...one });
        release();
      },
    });

    await observed;

    expect(seen).toEqual([
      { name: "live", event: "note", text: "Coverage run: unit" },
    ]);

    writeFileSync(gate, "");

    const entries = await running;

    expect(entries[0]).toMatchObject({ outcome: "ok" });
    expect(entries[0]?.stderr).toBe("");
  });

  it("drops an invalid event line, counts it and keeps the run", async () => {
    const { root, io } = setup();
    const seen: unknown[] = [];
    const script = pluginFile(
      root,
      `
      process.stderr.write('recognizer-event {not json}\\n');
      process.stderr.write('recognizer-event {"event":"later"}\\n');
      process.stderr.write('recognizer-event {"event":"progress","done":3}\\n');
      ${event({ event: "progress", done: 1, total: 2, unit: "functions" })}
      ${FINDINGS_BODY}
    `,
    );
    const entries = await runSensors({
      io,
      root,
      commit: COMMIT,
      scans: [],
      selected: [
        { name: "quick", runsTests: true, command: pluginCommand(script) },
      ],
      onEvent: (_name, one) => seen.push(one),
    });

    expect(entries[0]).toMatchObject({ outcome: "ok" });
    expect(entries[0]?.stderr).toBe("ignored 3 invalid event lines");
    expect(seen).toEqual([
      { event: "progress", done: 1, total: 2, unit: "functions" },
    ]);
  });

  it("leaves no sensor process behind when the scan's process group is killed", async () => {
    const marker = `47.${process.pid}`;
    const dist = pathToFileURL(resolve(__dirname, "../dist")).href;
    const script = `
      const { nodeIo } = await import("${dist}/cli.js");
      const { runSensors } = await import("${dist}/run-sensors.js");
      await runSensors({
        io: nodeIo(),
        root: process.cwd(),
        commit: "abc123",
        scans: [],
        selected: [{ name: "slow", command: ["sh", "-c", "sleep ${marker} & wait"] }],
      });
    `;
    const root = makeTempDir("run-sensors-group-");
    const scan = spawn(
      process.execPath,
      ["--input-type=module", "-e", script],
      { cwd: root, detached: true, stdio: "ignore" },
    );
    const running = () =>
      spawnSync("pgrep", ["-f", `sleep ${marker}`]).status === 0;

    for (let waited = 0; !running() && waited < 50; waited += 1) {
      await new Promise((done) => setTimeout(done, 100));
    }

    expect(running()).toBe(true);

    process.kill(-(scan.pid as number), "SIGTERM");

    for (let waited = 0; running() && waited < 30; waited += 1) {
      await new Promise((done) => setTimeout(done, 100));
    }

    expect(running()).toBe(false);
  });

  describe("recording inputs", () => {
    const HASH = "a".repeat(64);
    const OWN = "b".repeat(64);
    const scans = [
      {
        modules: [{ id: "shop/a.py" }],
        files: [{ path: "shop/a.py", hash: HASH }],
      },
    ] as unknown as Scan[];
    const writing = (extra: string) => `
      const fs = require("fs");
      const [commit, output] = process.argv.slice(1);
      fs.mkdirSync(require("path").dirname(output), { recursive: true });
      fs.writeFileSync(output, JSON.stringify({
        findings_version: 1,
        sensor: { name: "quick", version: "1" },
        commit, modified: false, settings: {}, findings: [], ${extra}
      }));
    `;

    async function sensed(extra: string) {
      const { root, io } = setup();
      const [entry] = await runSensors({
        io,
        root,
        commit: COMMIT,
        scans,
        selected: [
          {
            name: "quick",
            command: [
              process.execPath,
              "-e",
              writing(extra),
              "{commit}",
              "{output}",
            ],
          },
        ],
      });
      const file = join(root, ".recognizer/cache/findings/quick.json");
      const document = JSON.parse(readFileSync(file, "utf8"));

      return { entry, document };
    }

    it("adds every scanned module's hash to a document with none and writes version 2", async () => {
      const { entry, document } = await sensed("");

      expect(entry).toMatchObject({ outcome: "ok" });
      expect(document.findings_version).toBe(2);
      expect(document.inputs).toEqual({ "shop/a.py": HASH });
      expect(() => validateFindings(document)).not.toThrow();
    });

    it("keeps the inputs a sensor wrote itself", async () => {
      const { document } = await sensed(`inputs: { "shop/b.py": "${OWN}" }`);

      expect(document.findings_version).toBe(2);
      expect(document.inputs).toEqual({ "shop/b.py": OWN });
      expect(() => validateFindings(document)).not.toThrow();
    });
  });
});

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
        root,
        commit: COMMIT,
        scans: [],
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
      root,
      commit: COMMIT,
      scans: [],
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
      root,
      commit: COMMIT,
      scans: [],
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
      root,
      commit: COMMIT,
      scans: [],
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
        root,
        commit: COMMIT,
        scans: [],
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
        root,
        commit: COMMIT,
        scans: [],
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
        root,
        commit: COMMIT,
        scans: [],
        selected: [{ name: "quick", command: pluginCommand(refusing) }],
      });

      expect(entry?.diagnosis).toBeUndefined();
      expect(entry?.stderr).toContain("plain");
      expect(entry?.stderr).toContain("ignored 1 invalid event line");
    });
  }
});

describe("sense entry figures", () => {
  const scans = [
    {
      modules: [{ id: "a.py" }, { id: "b.py" }, { id: "c.py" }],
      files: [],
    },
  ] as unknown as Scan[];
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
    over: { runsTests?: boolean; modules?: number; clock?: number[] } = {},
  ) {
    const { root, io } = setup();
    const steps = over.clock ?? [];
    let at = 0;
    const ticking = {
      ...io,
      now: () =>
        steps.length > 0
          ? (steps[Math.min(at, steps.length - 1)] as number)
          : Date.now(),
    };
    const [entry] = await runSensors({
      io: ticking,
      root,
      commit: COMMIT,
      scans,
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

  it.each([
    ["stopped", "stopped: { measured: 3, total: 10 }"],
    ["partial", "partial: { measured: 3, total: 10 }"],
  ])(
    "records incomplete for a findings document carrying %s",
    async (_name, extra) => {
      const entry = await sensed(finishing(extra));

      expect(entry?.incomplete).toBe(true);
    },
  );

  it("carries no incomplete key for a document with neither", async () => {
    const entry = await sensed(finishing(""));

    expect(entry).not.toHaveProperty("incomplete");
  });
});
