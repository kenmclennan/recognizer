import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { nodeIo } from "../src/cli.js";
import { runSensors, SENSOR_TIMEOUT_MS } from "../src/run-sensors.js";

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

  it("fails a sensor still running at the ceiling as timed out and runs the next one", () => {
    const { root, io, messages } = setup();
    const entries: string[] = [];
    const results = runSensors({
      io,
      root,
      commit: COMMIT,
      timeoutMs: 300,
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
      readFileSync(join(root, ".recognizer/cache/findings/quick.json"), "utf8"),
    ).toContain('"quick"');
  });

  it("leaves no sensor process behind when the scan's process group is killed", async () => {
    const marker = `47.${process.pid}`;
    const dist = pathToFileURL(resolve(__dirname, "../dist")).href;
    const script = `
      const { nodeIo } = await import("${dist}/cli.js");
      const { runSensors } = await import("${dist}/run-sensors.js");
      runSensors({
        io: nodeIo(),
        root: process.cwd(),
        commit: "abc123",
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
});
