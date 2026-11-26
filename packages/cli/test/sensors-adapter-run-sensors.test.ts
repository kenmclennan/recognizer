import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Repository } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { FindingsAdapter } from "../src/adapters/filesystem/findings-adapter.js";
import { nodeIo } from "../src/cli.js";
import { validateFindings } from "../src/findings-document.js";
import { runSensors } from "../src/run-sensors.js";
import { repositoryFrom } from "./repository-from.js";
import {
  COMMIT,
  event,
  manifestCommand,
  manifestOf,
  pluginCommand,
  pluginFile,
  setup,
} from "./run-sensors-plugin.js";

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
        findings: new FindingsAdapter(io),
        root,
        commit: COMMIT,
        repository: Repository.empty,
        selected: [
          {
            name: "hung",
            command: pluginCommand(hung),
            manifest: manifestCommand(hung),
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
        findings: new FindingsAdapter(io),
        root,
        commit: COMMIT,
        repository: Repository.empty,
        selected: [
          {
            name: "quick",
            command: pluginCommand(limited),
            manifest: manifestCommand(limited),
          },
          {
            name: "quick",
            command: pluginCommand(open),
            manifest: manifestCommand(open),
          },
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
      findings: new FindingsAdapter(io),
      root,
      commit: COMMIT,
      repository: Repository.empty,
      selected: [
        {
          name: "quick",
          runsTests: true,
          command: pluginCommand(live),
          manifest: manifestCommand(live),
        },
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
      findings: new FindingsAdapter(io),
      root,
      commit: COMMIT,
      repository: Repository.empty,
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
        repository: Repository.empty,
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
    const scans = repositoryFrom([
      {
        modules: [{ id: "shop/a.py" }],
        files: [{ path: "shop/a.py", hash: HASH }],
      },
    ]);
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
        findings: new FindingsAdapter(io),
        root,
        commit: COMMIT,
        repository: scans,
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
