import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { type Io, nodeIo } from "../src/cli.js";
import type { PluginEvent } from "../src/plugin-events.js";
import {
  createPluginLimits,
  pluginPrefix,
  runPlugin,
} from "../src/plugin-run.js";
import { pluginLine } from "../src/scan-phases.js";

function manifest(extra: Record<string, unknown> = {}) {
  return {
    kind: "sensor",
    name: "fake",
    display: "Fake",
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

function plugin(directory: string, body: string, extra = {}): string[] {
  const file = join(
    directory,
    `plugin-${Math.random().toString(36).slice(2)}.cjs`,
  );

  writeFileSync(
    file,
    `const fs = require("fs");
const [verb] = process.argv.slice(2);
if (verb === "manifest") {
  const counter = ${JSON.stringify(join(directory, "manifest-calls"))};
  fs.appendFileSync(counter, "x");
  process.stdout.write(${JSON.stringify(JSON.stringify(manifest(extra)))} + "\\n");
  process.exit(0);
}
${body}
`,
  );

  return [process.execPath, file, "run", "{commit}", "{output}"];
}

const event = (value: Record<string, unknown>) =>
  `process.stderr.write("recognizer-event " + ${JSON.stringify(JSON.stringify(value))} + "\\n");`;

function pidWriter(directory: string): string {
  return `fs.writeFileSync(${JSON.stringify(join(directory, "pid"))}, String(process.pid));`;
}

function pidOf(directory: string): number {
  return Number(readFileSync(join(directory, "pid"), "utf8"));
}

async function until(done: () => boolean, ms = 10_000): Promise<void> {
  for (let waited = 0; !done() && waited < ms; waited += 20) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function harness(graceMs = 100) {
  const directory = makeTempDir("plugin-run-");
  const io: Io = nodeIo();
  const limits = createPluginLimits(io, directory, graceMs);

  return { directory, io, limits };
}

function run(
  h: ReturnType<typeof harness>,
  command: string[],
  onEvent?: (name: string, event: PluginEvent) => void,
) {
  return runPlugin(
    h.io,
    h.limits,
    h.directory,
    command,
    "abc",
    join(h.directory, "out.json"),
    "findings",
    () => {},
    "fallback",
    onEvent,
  );
}

describe("runPlugin events", () => {
  it(
    "forwards a plugin's start, progress and note events tagged with its manifest name and keeps them out of stderr",
    async () => {
      const h = harness();
      const sent: PluginEvent[] = [
        { event: "start", total: 2, unit: "functions" },
        { event: "progress", done: 1, total: 2, unit: "functions" },
        { event: "progress", done: 2, total: 2, unit: "functions" },
        { event: "note", text: "Coverage run: unit" },
      ];
      const lines: string[] = [];
      const result = await run(
        h,
        plugin(h.directory, sent.map(event).join("\n")),
        (name, one) => lines.push(pluginLine("sense", name, one)),
      );

      expect(lines.map((one) => JSON.parse(one))).toEqual(
        sent.map((data) => ({
          event: "plugin",
          phase: "sense",
          name: "fake",
          data,
        })),
      );
      expect(result.stderr).not.toContain("recognizer-event");
    },
    scaledTimeout(20_000),
  );

  it(
    "forwards three valid events and counts two invalid lines in the stderr",
    async () => {
      const h = harness();
      const seen: PluginEvent[] = [];
      const result = await run(
        h,
        plugin(
          h.directory,
          [
            event({ event: "start", total: 1, unit: "functions" }),
            'process.stderr.write("recognizer-event {not json\\n");',
            event({ event: "note", text: "midway" }),
            'process.stderr.write("recognizer-event {\\"event\\":\\"nope\\"}\\n");',
            event({ event: "progress", done: 1, total: 1, unit: "functions" }),
          ].join("\n"),
        ),
        (_name, one) => seen.push(one),
      );

      expect(seen).toHaveLength(3);
      expect(result.stderr.trim()).toBe("ignored 2 invalid event lines");
    },
    scaledTimeout(20_000),
  );
});

describe("runPlugin time limits", () => {
  const limited = { long_running: false, time_limit_seconds: 1 };

  it(
    "times out a plugin that outlives its manifest limit",
    async () => {
      const h = harness();
      const result = await run(
        h,
        plugin(
          h.directory,
          `${pidWriter(h.directory)}\nsetInterval(() => {}, 1000);`,
          limited,
        ),
      );

      expect(existsSync(join(h.directory, "pid"))).toBe(true);
      expect(result.reason).toBe("timed out");
    },
    scaledTimeout(20_000),
  );

  it(
    "has a plugin that exits on TERM gone before the grace passes",
    async () => {
      const h = harness(60_000);
      const began = Date.now();

      await run(
        h,
        plugin(
          h.directory,
          `${pidWriter(h.directory)}\nprocess.on("SIGTERM", () => process.exit(0));\nsetInterval(() => {}, 1000);`,
          limited,
        ),
      );

      expect(Date.now() - began).toBeLessThan(30_000);
      await until(() => !nodeIo().pidAlive(pidOf(h.directory)));
      expect(nodeIo().pidAlive(pidOf(h.directory))).toBe(false);
    },
    scaledTimeout(40_000),
  );

  it(
    "kills a plugin that ignores TERM after the grace",
    async () => {
      const h = harness(300);
      const began = Date.now();
      const result = await run(
        h,
        plugin(
          h.directory,
          `${pidWriter(h.directory)}\nprocess.on("SIGTERM", () => {});\nsetInterval(() => {}, 1000);`,
          limited,
        ),
      );

      expect(result.reason).toBe("timed out");
      expect(Date.now() - began).toBeGreaterThanOrEqual(1300);
      await until(() => !nodeIo().pidAlive(pidOf(h.directory)));
      expect(nodeIo().pidAlive(pidOf(h.directory))).toBe(false);
    },
    scaledTimeout(40_000),
  );

  it(
    "gives a long_running plugin no limit",
    async () => {
      const h = harness();
      const running = run(
        h,
        plugin(
          h.directory,
          `${pidWriter(h.directory)}\nsetInterval(() => {}, 1000);`,
          {
            long_running: true,
          },
        ),
      );

      await until(() => existsSync(join(h.directory, "pid")));
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const pid = pidOf(h.directory);

      expect(nodeIo().pidAlive(pid)).toBe(true);

      process.kill(pid, "SIGKILL");
      await running;
    },
    scaledTimeout(40_000),
  );

  it(
    "runs a command with no run element with no limit and no manifest call",
    async () => {
      const h = harness();
      const marker = join(h.directory, "ran");
      const result = await run(h, [
        process.execPath,
        "-e",
        `require("fs").writeFileSync(${JSON.stringify(marker)}, "")`,
      ]);

      expect(existsSync(marker)).toBe(true);
      expect(existsSync(join(h.directory, "manifest-calls"))).toBe(false);
      expect(result.status).toBe(0);
      expect(pluginPrefix([process.execPath, "-e", "x"])).toBeNull();
    },
    scaledTimeout(20_000),
  );

  it(
    "reads the manifest once for two runs of the same plugin",
    async () => {
      const h = harness();
      const command = plugin(h.directory, "process.exit(0);");

      await run(h, command);
      await run(h, command);

      expect(readFileSync(join(h.directory, "manifest-calls"), "utf8")).toBe(
        "x",
      );
    },
    scaledTimeout(20_000),
  );

  it(
    "accepts either a completed run or a timeout when the limit equals the run time and leaves no half-written document",
    async () => {
      const h = harness();
      const output = join(h.directory, "out.json");
      const result = await runPlugin(
        h.io,
        h.limits,
        h.directory,
        plugin(
          h.directory,
          `setTimeout(() => { fs.writeFileSync(process.argv[4], '{"complete":true}'); }, 1000);`,
          limited,
        ),
        "abc",
        output,
        "findings",
        () => {},
        "fallback",
      );

      expect([null, "timed out"]).toContain(
        result.reason === null || result.reason === "timed out"
          ? result.reason
          : "other",
      );

      if (existsSync(output)) {
        expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({
          complete: true,
        });
      }
    },
    scaledTimeout(40_000),
  );
});
