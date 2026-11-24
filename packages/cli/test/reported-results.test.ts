import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Repository } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { FindingsAdapter } from "../src/adapters/filesystem/findings-adapter.js";
import { nodeIo } from "../src/cli.js";
import { findingsFile, overlayFile } from "../src/findings-files.js";
import { createPluginLimits } from "../src/plugin-run.js";
import { runSensors } from "../src/run-sensors.js";

const COMMIT = "abc123";

const METRICS = [
  {
    name: "crap",
    label: "C.R.A.P.",
    help: "change risk",
    type: "number",
    granularity: "member",
    bad: "high",
  },
];

const DECLARED = [
  { name: "crap", type: "number", granularity: "member", bad: "high" },
];

function manifestOf(extra: Record<string, unknown> = {}) {
  return {
    kind: "sensor",
    name: "quick",
    display: "Quick",
    version: "1",
    protocol: 4,
    install: "brew install --cask kenmclennan/tap/recognizer",
    check: false,
    long_running: true,
    units: ["functions"],
    settings: [],
    metrics: METRICS,
    findings: [],
    runs_tests: false,
    scoped: false,
    ...extra,
  };
}

function finding(id: string) {
  return {
    id,
    kind: "crap",
    severity: "warning",
    principle: "change-risk-anti-patterns",
    summary: id,
    evidence: { modules: ["a.py"] },
  };
}

const START = { event: "start", total: 4, unit: "functions" };

function progress(done: number) {
  return { event: "progress", done, total: 4, unit: "functions" };
}

function result(id: string, value: number) {
  return {
    event: "result",
    findings: [finding(`crap:${id}`)],
    overlay: { crap: { [id]: value } },
  };
}

function settled(extra: Record<string, unknown> = {}) {
  return { event: "settled", modified: false, settings: {}, ...extra };
}

const COMPLETE = settled({ counts: { measured: 4, total: 4 } });

interface Script {
  events: Record<string, unknown>[];
  status?: number;
  hang?: boolean;
  record?: string;
  manifest?: Record<string, unknown>;
}

function pluginFile(root: string, script: Script): string {
  const file = join(root, "plugin.cjs");
  const lines = script.events.map(
    (event) =>
      `process.stderr.write("recognizer-event " + ${JSON.stringify(JSON.stringify(event))} + "\\n");`,
  );

  writeFileSync(
    file,
    `const [verb] = process.argv.slice(2);
if (verb === "manifest") {
  process.stdout.write(${JSON.stringify(JSON.stringify(manifestOf(script.manifest)))} + "\\n");
  process.exit(0);
}
${script.record === undefined ? "" : `require("fs").writeFileSync(${JSON.stringify(script.record)}, String(process.env.RECOGNIZER_PROTOCOL));`}
${lines.join("\n")}
${script.hang === true ? "setTimeout(() => {}, 30000);" : `process.exit(${script.status ?? 0});`}
`,
  );

  return file;
}

function setup() {
  const root = makeTempDir("reported-results-");
  const messages: string[] = [];
  const io = { ...nodeIo(), stderr: (text: string) => messages.push(text) };

  return { root, io, messages };
}

async function go(
  root: string,
  io: ReturnType<typeof nodeIo>,
  script: Script,
  onEvent?: (name: string, event: { event: string }) => void,
) {
  const file = pluginFile(root, script);
  const entries = await runSensors({
    io,
    root,
    commit: COMMIT,
    repository: Repository.empty,
    findings: new FindingsAdapter(io),
    scope: { kind: "working-tree" },
    modified: false,
    limits: createPluginLimits(io, root, 200),
    selected: [
      {
        name: "quick",
        command: [process.execPath, file, "run"],
        manifest: [process.execPath, file, "manifest"],
      },
    ],
    ...(onEvent === undefined ? {} : { onEvent }),
  });

  return entries[0];
}

function read(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function seed(root: string, measured: number) {
  const findings = findingsFile(root, "quick");
  const overlays = overlayFile(root, "quick");

  mkdirSync(dirname(findings), { recursive: true });
  mkdirSync(dirname(overlays), { recursive: true });
  writeFileSync(
    findings,
    JSON.stringify({
      findings_version: 2,
      sensor: { name: "quick", version: "1" },
      commit: COMMIT,
      modified: false,
      settings: {},
      counts: { measured, total: 10 },
      findings: [finding("crap:old")],
      inputs: {},
    }),
  );
  writeFileSync(
    overlays,
    JSON.stringify({
      overlay_version: 2,
      commit: COMMIT,
      modified: false,
      producer: { name: "quick", version: "1" },
      metrics: DECLARED,
      values: { crap: { old: 1 } },
      inputs: {},
    }),
  );
}

function ids(root: string): string[] {
  return read(findingsFile(root, "quick")).findings.map(
    ({ id }: { id: string }) => id,
  );
}

const STOPPED = settled({ stopped: { measured: 2, total: 4 } });

describe("a plugin that reports its results", () => {
  it("a_reporting_plugin_leaves_findings_and_overlay_written_by_core", async () => {
    const { root, io } = setup();
    const entry = await go(root, io, {
      events: [START, result("f", 3), COMPLETE],
    });

    expect(entry).toMatchObject({ outcome: "ok" });
    expect(ids(root)).toEqual(["crap:f"]);
    expect(read(overlayFile(root, "quick")).values).toEqual({ crap: { f: 3 } });
    expect(existsSync(`${findingsFile(root, "quick")}.tmp`)).toBe(false);
    expect(existsSync(`${overlayFile(root, "quick")}.tmp`)).toBe(false);
  });

  it("exit_zero_replaces_findings_and_overlay_together", async () => {
    const { root, io } = setup();

    seed(root, 2);
    await go(root, io, { events: [START, result("new", 5), COMPLETE] });

    expect(ids(root)).toEqual(["crap:new"]);
    expect(read(overlayFile(root, "quick")).values).toEqual({
      crap: { new: 5 },
    });
  });

  it("a_stopped_run_keeps_what_it_reported", async () => {
    const { root, io } = setup();
    const entry = await go(root, io, {
      events: [START, result("f", 3), STOPPED],
      status: 143,
    });

    expect(entry?.outcome).toBe("failed");
    expect(read(findingsFile(root, "quick"))).toMatchObject({
      stopped: { measured: 2, total: 4 },
    });
    expect(ids(root)).toEqual(["crap:f"]);
    expect(read(overlayFile(root, "quick")).values).toEqual({ crap: { f: 3 } });
  });

  it("a_timed_out_run_keeps_what_it_reported", async () => {
    const { root, io } = setup();
    const entry = await go(root, io, {
      events: [
        START,
        progress(1),
        result("f", 3),
        settled({ partial: { measured: 1, total: 4 } }),
      ],
      hang: true,
      manifest: { long_running: false, time_limit_seconds: 1 },
    });

    expect(entry).toMatchObject({ outcome: "failed", reason: "timed out" });
    expect(ids(root)).toEqual(["crap:f"]);
    expect(read(findingsFile(root, "quick")).partial).toEqual({
      measured: 1,
      total: 4,
    });
  });

  it("a_failed_run_keeps_what_it_reported", async () => {
    const { root, io } = setup();
    const entry = await go(root, io, {
      events: [START, progress(2), result("f", 3)],
      status: 1,
    });

    expect(entry?.outcome).toBe("failed");
    expect(ids(root)).toEqual(["crap:f"]);
    expect(read(findingsFile(root, "quick")).partial).toEqual({
      measured: 2,
      total: 4,
    });
  });

  it("a_smaller_checkpoint_keeps_the_complete_findings_and_overlay", async () => {
    const { root, io } = setup();

    seed(root, 10);

    expect(ids(root)).toEqual(["crap:old"]);

    await go(root, io, {
      events: [
        START,
        result("f", 3),
        settled({ stopped: { measured: 3, total: 10 } }),
      ],
      status: 143,
    });

    expect(ids(root)).toEqual(["crap:old"]);
    expect(read(overlayFile(root, "quick")).values).toEqual({
      crap: { old: 1 },
    });
  });

  it("a_checkpoint_that_measured_exactly_as_many_replaces_both", async () => {
    const { root, io } = setup();

    seed(root, 10);
    await go(root, io, {
      events: [
        START,
        result("f", 3),
        settled({ stopped: { measured: 10, total: 10 } }),
      ],
      status: 143,
    });

    expect(ids(root)).toEqual(["crap:f"]);
    expect(read(overlayFile(root, "quick")).values).toEqual({ crap: { f: 3 } });
  });

  it("a_checkpoint_that_measured_one_less_keeps_both", async () => {
    const { root, io } = setup();

    seed(root, 10);
    await go(root, io, {
      events: [
        START,
        result("f", 3),
        settled({ stopped: { measured: 9, total: 10 } }),
      ],
      status: 143,
    });

    expect(ids(root)).toEqual(["crap:old"]);
    expect(read(overlayFile(root, "quick")).values).toEqual({
      crap: { old: 1 },
    });
  });

  it("exit_zero_without_settling_fails_the_run", async () => {
    const { root, io } = setup();
    const entry = await go(root, io, { events: [START, result("f", 3)] });

    expect(entry).toMatchObject({
      outcome: "failed",
      reason: "the plugin ended without settling its results",
    });
    expect(ids(root)).toEqual(["crap:f"]);
    expect(read(findingsFile(root, "quick")).partial).toBeDefined();
  });

  it("exit_zero_with_results_after_the_last_settled_fails_the_run", async () => {
    const { root, io } = setup();
    const entry = await go(root, io, {
      events: [START, result("f", 3), COMPLETE, result("g", 4)],
    });

    expect(entry).toMatchObject({
      outcome: "failed",
      reason: "the plugin ended without settling its results",
    });
    expect(ids(root)).toEqual(["crap:f", "crap:g"]);
    expect(read(findingsFile(root, "quick")).partial).toBeDefined();
  });

  it("a_refused_result_fails_the_run_and_keeps_the_accepted_ones", async () => {
    const { root, io } = setup();
    const entry = await go(root, io, {
      events: [
        START,
        result("f", 3),
        { event: "result", overlay: { churn: { x: 1 } } },
        result("g", 4),
        COMPLETE,
      ],
    });

    expect(entry?.outcome).toBe("failed");
    expect(entry?.reason).toMatch(/^a result was refused: /);
    expect(ids(root)).toEqual(["crap:f", "crap:g"]);
  });

  it("a_leftover_pending_pair_is_promoted_before_the_next_run", async () => {
    const { root, io } = setup();
    const findings = `${findingsFile(root, "quick")}.tmp`;
    const overlays = `${overlayFile(root, "quick")}.tmp`;

    seed(root, 2);
    mkdirSync(dirname(findings), { recursive: true });
    writeFileSync(
      findings,
      JSON.stringify({
        findings_version: 2,
        sensor: { name: "quick", version: "1" },
        commit: COMMIT,
        modified: false,
        settings: {},
        partial: { measured: 3, total: 4 },
        findings: [finding("crap:pending")],
        inputs: {},
      }),
    );
    writeFileSync(
      overlays,
      JSON.stringify({
        overlay_version: 2,
        commit: COMMIT,
        modified: false,
        producer: { name: "quick", version: "1" },
        metrics: DECLARED,
        values: { crap: { pending: 7 } },
        inputs: {},
      }),
    );

    await go(root, io, { events: [START], status: 1 });

    expect(existsSync(findings)).toBe(false);
    expect(existsSync(overlays)).toBe(false);
    expect(read(overlayFile(root, "quick")).values).toEqual({
      crap: { pending: 7 },
    });
  });

  it("result_and_settled_events_are_not_forwarded_to_onEvent", async () => {
    const { root, io } = setup();
    const seen: string[] = [];

    await go(
      root,
      io,
      { events: [START, progress(1), result("f", 3), COMPLETE] },
      (_name, event) => seen.push(event.event),
    );

    expect(seen).toEqual(["start", "progress"]);
  });

  it("every_sensor_is_started_with_RECOGNIZER_PROTOCOL_4", async () => {
    const { root, io } = setup();
    const record = join(root, "protocol.txt");

    await go(root, io, {
      events: [START, result("f", 3), COMPLETE],
      record,
    });

    expect(readFileSync(record, "utf8")).toBe("4");
  });

  it("a_plugin_that_writes_its_own_file_still_works", async () => {
    const { root, io } = setup();
    const file = join(root, "writes.cjs");

    writeFileSync(
      file,
      `const fs = require("fs");
if (process.argv[2] === "manifest") {
  process.stdout.write(${JSON.stringify(JSON.stringify(manifestOf()))} + "\\n");
  process.exit(0);
}
const [commit, output] = process.argv.slice(3);
fs.mkdirSync(require("path").dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({
  findings_version: 1,
  sensor: { name: "quick", version: "1" },
  commit,
  modified: false,
  settings: {},
  findings: [],
}));
`,
    );

    const [entry] = await runSensors({
      io,
      root,
      commit: COMMIT,
      repository: Repository.empty,
      findings: new FindingsAdapter(io),
      limits: createPluginLimits(io, root, 200),
      selected: [
        {
          name: "quick",
          command: [process.execPath, file, "run", "{commit}", "{output}"],
          manifest: [process.execPath, file, "manifest"],
        },
      ],
    });

    expect(entry).toMatchObject({ outcome: "ok" });
    expect(ids(root)).toEqual([]);
  });
});
