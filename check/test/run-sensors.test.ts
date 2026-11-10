import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { nodeIo } from "../src/cli.js";
import { validateFindings } from "../src/findings-document.js";
import { runSensors, SENSOR_TIMEOUT_MS } from "../src/run-sensors.js";
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

function setup() {
  const root = makeTempDir("run-sensors-");
  const messages: string[] = [];
  const io = { ...nodeIo(), stderr: (text: string) => messages.push(text) };

  return { root, io, messages };
}

describe("runSensors ceiling", () => {
  it("allows a sensor sixty seconds", () => {
    expect(SENSOR_TIMEOUT_MS).toBe(60_000);
  });

  it(
    "fails a sensor still running at the ceiling as timed out and runs the next one",
    async () => {
      const { root, io, messages } = setup();
      const entries: string[] = [];
      const results = await runSensors({
        io,
        root,
        commit: COMMIT,
        scans: [],
        timeoutMs: 3000,
        selected: [
          {
            name: "hung",
            command: ["sh", "-c", "sleep 30 & wait"],
          },
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
    "gives a runsTests selection no timeout and the others the ceiling",
    async () => {
      const { root, messages } = setup();
      const timeouts: (number | undefined)[] = [];
      const real = nodeIo();
      const io = {
        ...real,
        stderr: (text: string) => messages.push(text),
        run: (
          command: string,
          args: string[],
          options?: { cwd?: string; timeoutMs?: number },
        ) => {
          timeouts.push(options?.timeoutMs);

          return real.run(command, args, options);
        },
        runAsync: (
          command: string,
          args: string[],
          options?: { cwd?: string; timeoutMs?: number },
        ) => {
          timeouts.push(options?.timeoutMs);

          return real.runAsync(command, args, options);
        },
      };

      await runSensors({
        io,
        root,
        commit: COMMIT,
        scans: [],
        selected: [
          { name: "slow-one", command: ["true"], runsTests: true },
          { name: "quick-one", command: ["true"], runsTests: false },
          { name: "plain-one", command: ["true"] },
        ],
      });

      expect(timeouts).toEqual([
        undefined,
        SENSOR_TIMEOUT_MS,
        SENSOR_TIMEOUT_MS,
      ]);
    },
    scaledTimeout(20000),
  );

  it("hands a progress line to onProgress while the sensor is still running", async () => {
    const { root, io } = setup();
    const seen: unknown[] = [];
    let release: () => void = () => {};
    const observed = new Promise<void>((done) => {
      release = done;
    });
    const script = `
      const fs = require("fs");
      const [commit, output, gate] = process.argv.slice(1);
      process.stderr.write('recognizer-progress {"step":"coverage"}\\n');
      const wait = () => fs.existsSync(gate) ? finish() : setTimeout(wait, 10);
      const finish = () => {
        fs.mkdirSync(require("path").dirname(output), { recursive: true });
        fs.writeFileSync(output, JSON.stringify({
          findings_version: 1,
          sensor: { name: "live", version: "1" },
          commit, modified: false, settings: {}, findings: [],
        }));
      };
      wait();
    `;
    const gate = join(root, "gate");
    const running = runSensors({
      io,
      root,
      commit: COMMIT,
      scans: [],
      selected: [
        {
          name: "live",
          runsTests: true,
          command: [
            process.execPath,
            "-e",
            script,
            "{commit}",
            "{output}",
            gate,
          ],
        },
      ],
      onProgress: (name, progress) => {
        seen.push({ name, ...progress });
        release();
      },
    });

    await observed;

    expect(seen).toEqual([{ name: "live", step: "coverage" }]);

    writeFileSync(gate, "");

    const entries = await running;

    expect(entries[0]).toMatchObject({ outcome: "ok" });
    expect(entries[0]?.stderr).toBe("");
  });

  it("drops a malformed or unknown-step progress line and keeps the run", async () => {
    const { root, io } = setup();
    const seen: unknown[] = [];
    const script = `
      process.stderr.write('recognizer-progress {not json}\\n');
      process.stderr.write('recognizer-progress {"step":"later"}\\n');
      process.stderr.write('recognizer-progress {"step":"mutants","done":3,"total":2}\\n');
      process.stderr.write('recognizer-progress {"step":"mutants","done":1,"total":2}\\n');
      ${WRITES_FINDINGS}
    `;
    const entries = await runSensors({
      io,
      root,
      commit: COMMIT,
      scans: [],
      selected: [
        {
          name: "quick",
          runsTests: true,
          command: [process.execPath, "-e", script, "{commit}", "{output}"],
        },
      ],
      onProgress: (_name, progress) => seen.push(progress),
    });

    expect(entries[0]).toMatchObject({ outcome: "ok" });
    expect(seen).toEqual([{ step: "mutants", done: 1, total: 2 }]);
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

const REFUSES = `
const [reason, plain] = process.argv.slice(1);
process.stderr.write(reason + "\\n" + plain + "\\n");
process.exit(2);
`;

const WRITES_DIAGNOSIS = `
const fs = require("fs");
const [commit, output, diagnosis] = process.argv.slice(1);
fs.mkdirSync(require("path").dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({
  findings_version: 1,
  sensor: { name: "quick", version: "1" },
  commit,
  modified: false,
  settings: {},
  findings: [],
  diagnosis: JSON.parse(diagnosis),
}));
`;

describe("runSensors diagnosis", () => {
  for (const runsTests of [false, true]) {
    it(`carries a refusal's reason line to the entry and keeps the plain line as the reason (runsTests ${runsTests})`, async () => {
      const { root, io } = setup();
      const [entry] = await runSensors({
        io,
        root,
        commit: COMMIT,
        scans: [],
        selected: [
          {
            name: "quick",
            runsTests,
            command: [
              process.execPath,
              "-e",
              REFUSES,
              `recognizer-reason ${JSON.stringify(DIAGNOSIS)}`,
              DIAGNOSIS.line,
            ],
          },
        ],
      });

      expect(entry?.diagnosis).toEqual(DIAGNOSIS);
      expect(entry?.reason).toBe(DIAGNOSIS.line);
      expect(entry?.stderr).not.toContain("recognizer-reason");
    });
  }

  it("carries the findings document's diagnosis on a run that exits zero", async () => {
    const { root, io } = setup();
    const [entry] = await runSensors({
      io,
      root,
      commit: COMMIT,
      scans: [],
      selected: [
        {
          name: "quick",
          command: [
            process.execPath,
            "-e",
            WRITES_DIAGNOSIS,
            "{commit}",
            "{output}",
            JSON.stringify({
              code: "tests-failed",
              line: "3 tests failed, so coverage may read low",
              failing: { count: 3, names: ["a", "b", "c"] },
            }),
          ],
        },
      ],
    });

    expect(entry).toMatchObject({
      outcome: "ok",
      diagnosis: { code: "tests-failed", failing: { count: 3 } },
    });
  });

  for (const code of ["tool-missing", "coverage-unavailable"]) {
    it(`fails an exit-zero sensor whose diagnosis is ${code} with the diagnosis line as the reason`, async () => {
      const { root, io } = setup();
      const diagnosis = {
        code,
        line: "coverage and pytest are not installed",
        fix: "uv sync",
      };
      const [entry] = await runSensors({
        io,
        root,
        commit: COMMIT,
        scans: [],
        selected: [
          {
            name: "quick",
            command: [
              process.execPath,
              "-e",
              WRITES_DIAGNOSIS,
              "{commit}",
              "{output}",
              JSON.stringify(diagnosis),
            ],
          },
        ],
      });

      expect(entry).toMatchObject({
        outcome: "failed",
        reason: diagnosis.line,
        diagnosis,
      });
    });
  }

  for (const [label, reason] of [
    ["not valid JSON", "recognizer-reason {nope"],
    [
      "an unknown code",
      `recognizer-reason ${JSON.stringify({ ...DIAGNOSIS, code: "odd" })}`,
    ],
    [
      "an extra key",
      `recognizer-reason ${JSON.stringify({ ...DIAGNOSIS, extra: 1 })}`,
    ],
    [
      "six names",
      `recognizer-reason ${JSON.stringify({
        code: "tests-failed",
        line: "x",
        failing: { names: ["1", "2", "3", "4", "5", "6"] },
      })}`,
    ],
  ] as const) {
    it(`leaves a reason line that is ${label} in the stderr and gives no diagnosis`, async () => {
      const { root, io } = setup();
      const [entry] = await runSensors({
        io,
        root,
        commit: COMMIT,
        scans: [],
        selected: [
          {
            name: "quick",
            command: [process.execPath, "-e", REFUSES, reason, "plain"],
          },
        ],
      });

      expect(entry?.diagnosis).toBeUndefined();
      expect(entry?.stderr).toContain(reason);
    });
  }
});
