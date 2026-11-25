import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Run, SensorRegistry } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { ActiveRunAdapter } from "../src/adapters/filesystem/active-run-adapter.js";
import { ConfigAdapter } from "../src/adapters/filesystem/config-adapter.js";
import { RunLogAdapter } from "../src/adapters/filesystem/run-log-adapter.js";
import { nodeIo } from "../src/cli.js";
import { validateRunRecord } from "../src/log-document.js";
import { logDirectory, openPhasedRunLog } from "../src/run-log.js";
import {
  markerPath,
  parseMarker,
  progressPath,
  type ScanRunRecord,
} from "../src/scan-marker.js";
import { REPO } from "./helpers.js";

const RUN_ID = "11111111-2222-3333-4444-555555555555";

function deadPid(): number {
  const result = spawnSync(process.execPath, ["-e", ""]);

  return result.pid;
}

function marker(
  root: string,
  changes: Partial<ScanRunRecord> = {},
  progress = "",
): string {
  const path = markerPath(root);

  mkdirSync(join(root, ".recognizer", "cache"), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      version: 5,
      run_id: RUN_ID,
      pid: process.pid,
      pgid: process.pid,
      started_at: new Date().toISOString(),
      started_by: "cli",
      repository: root,
      sensors: ["tally", "margin"],
      describe: false,
      suites: {},
      phase: "running",
      ended_at: null,
      exit: null,
      gaps: [],
      failure: null,
      commit: null,
      ran: null,
      ...changes,
    }),
  );
  writeFileSync(progressPath(root), progress);

  return path;
}

const line = (value: unknown) => `${JSON.stringify(value)}\n`;

function logRecords(root: string) {
  return readdirSync(logDirectory(root))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) =>
      validateRunRecord(
        JSON.parse(readFileSync(join(logDirectory(root), name), "utf8")),
      ),
    );
}

describe("active run adapter", () => {
  it("a_full_scan_progress_log_yields_the_run_model", () => {
    const root = makeTempDir("active-run-full-scan-");
    const ask = {
      event: "confirm",
      phase: "describe",
      modules: 3,
      model: "haiku",
      input_tokens: 1200,
      cost_usd: 0.4,
    };

    marker(
      root,
      { describe: true, sensors: ["tally"] },
      [
        line({ event: "preflight", state: "ok" }),
        line({
          event: "phase",
          phase: "extract",
          state: "run",
          commit: null,
          reason: "forced",
          languages: ["python", "rust"],
        }),
        line({
          event: "plugin",
          phase: "extract",
          name: "python",
          data: { event: "start", total: 10, unit: "files" },
        }),
        line({
          event: "entry",
          phase: "extract",
          name: "python",
          outcome: "ok",
          modules: 3,
          edges: 1,
        }),
        line({
          event: "entry",
          phase: "extract",
          name: "rust",
          outcome: "failed",
          reason: "no cargo",
        }),
        line({ event: "structure", state: "run" }),
        line({ event: "structure", state: "done", files: 3 }),
        line(ask),
        line({ event: "answered", phase: "describe", describe: true }),
        line({ event: "phase", phase: "describe", total: 3 }),
        line({
          event: "entry",
          phase: "describe",
          name: "a.py",
          outcome: "ok",
        }),
        line({
          event: "entry",
          phase: "describe",
          name: "b.py",
          outcome: "failed",
          reason: "timed out",
        }),
        line({
          event: "entry",
          phase: "describe",
          name: "c.py",
          outcome: "ok",
        }),
        line({ event: "phase", phase: "sense", total: 1 }),
        line({ event: "start", phase: "sense", name: "tally" }),
        line({
          event: "entry",
          phase: "sense",
          name: "tally",
          outcome: "ok",
        }),
        line({ event: "summary", exit: 1, log: "run-1" }),
      ].join(""),
    );

    const read = new ActiveRunAdapter(nodeIo()).read(root, null);

    if (read.kind !== "live") {
      throw new Error(`expected a live read, got ${read.kind}`);
    }

    const run = read.reports.reduce(
      (held, report) => held.apply(report),
      Run.begin({
        id: read.record.runId,
        startedBy: read.record.startedBy,
        startedAt: read.record.startedAt,
        scope: read.record.scope,
        choices: { sensors: ["tally"], describe: true, suites: {} },
      }),
    );
    const view = run.view();

    expect(
      view.plugins.map(({ phase, name, state }) => `${phase}:${name}:${state}`),
    ).toEqual([
      "extract:python:finished",
      "extract:rust:failed",
      "describe:describe:finished",
      "sense:tally:finished",
    ]);
    expect(view.plugins[1]?.failure?.reason).toBe("no cargo");
    expect(view.plugins[2]?.tally).toEqual({
      ok: 2,
      failed: 1,
      firstFailure: { item: "b.py", reason: "timed out" },
    });
    expect(view.structure).toEqual({ state: "done", files: 3 });
    expect(view.log).toBe("run-1");
    expect(view.confirmation).toEqual({
      ask: { modules: 3, model: "haiku", inputTokens: 1200, costUsd: 0.4 },
      answer: "describe",
    });
  });

  it("reads_a_live_marker_and_its_progress_lines", () => {
    const root = makeTempDir("active-run-live-");

    marker(
      root,
      {},
      [
        line({ event: "phase", phase: "sense", total: 2 }),
        line({ event: "start", phase: "sense", name: "tally" }),
        line({
          event: "plugin",
          phase: "sense",
          name: "tally",
          data: { event: "start", total: 4, unit: "files" },
        }),
        line({
          event: "plugin",
          phase: "sense",
          name: "tally",
          data: { event: "progress", done: 2, total: 4, unit: "files" },
        }),
        line({ event: "start", phase: "extract", name: "typescript" }),
      ].join(""),
    );

    const read = new ActiveRunAdapter(nodeIo()).read(root, null);

    expect(read.kind).toBe("live");

    if (read.kind !== "live") {
      return;
    }

    expect(read.record).toMatchObject({
      runId: RUN_ID,
      phase: "running",
      sensors: ["tally", "margin"],
      scope: { kind: "working-tree" },
    });
    expect(read.reports).toEqual([
      { kind: "plugin-started", name: "tally", progress: null },
      {
        kind: "plugin-progress",
        name: "tally",
        progress: { done: 0, total: 4, unit: "files" },
      },
      {
        kind: "plugin-progress",
        name: "tally",
        progress: { done: 2, total: 4, unit: "files" },
      },
    ]);

    const again = new ActiveRunAdapter(nodeIo()).read(root, {
      runId: RUN_ID,
      offset: read.offset,
    });

    expect(again).toMatchObject({ kind: "live", reports: [] });
  });

  it("a_dead_owner_reads_killed", () => {
    const root = makeTempDir("active-run-killed-");

    marker(root, { pid: deadPid() });

    expect(new ActiveRunAdapter(nodeIo()).read(root, null).kind).toBe("killed");

    marker(root, {
      pid: deadPid(),
      phase: "finished",
      exit: 0,
      ended_at: new Date().toISOString(),
      ran: [],
    });

    expect(new ActiveRunAdapter(nodeIo()).read(root, null).kind).toBe("ended");
  });

  it("settle_killed_rewrites_the_marker_as_stopped_for_the_same_run_id_only", () => {
    const root = makeTempDir("active-run-settle-");
    const adapter = new ActiveRunAdapter(nodeIo());
    const path = marker(root, { pid: deadPid() });
    const read = adapter.read(root, null);

    if (read.kind !== "killed") {
      throw new Error(`expected killed, read ${read.kind}`);
    }

    adapter.settleKilled(root, { ...read.record, runId: "another-run" });

    expect(parseMarker(readFileSync(path, "utf8"))?.phase).toBe("running");

    adapter.settleKilled(root, read.record);

    const settled = parseMarker(readFileSync(path, "utf8"));

    expect(settled).toMatchObject({ phase: "stopped", run_id: RUN_ID });
    expect(settled?.ended_at).not.toBeNull();
    expect(existsSync(`${path}.settle.tmp`)).toBe(false);
    expect(adapter.read(root, null).kind).toBe("ended");
  });

  it("settle_killed_finishes_the_open_log_record_and_the_record_validates", () => {
    const root = makeTempDir("active-run-log-");
    const io = nodeIo();
    const started = Date.now() - 1000;
    const open = openPhasedRunLog(io, root, started, "tester", ["scan"]);

    open.update([
      {
        phase: "sense",
        entries: [
          {
            name: "tally",
            command: ["recognizer-sense-tally"],
            status: 0,
            outcome: "ok",
            duration_ms: 5,
            stderr: "",
          },
        ],
      },
    ]);

    new RunLogAdapter(io).settleKilled(root, {
      runId: RUN_ID,
      startedAt: new Date(started).toISOString(),
      startedBy: "cli",
      running: ["margin"],
    });

    const records = logRecords(root);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ outcome: "stopped", exit: 1 });
    expect(records[0]?.finished).not.toBeNull();

    const entries = records[0]?.phases?.flatMap((phase) => phase.entries);

    expect(entries?.map(({ name }) => name)).toEqual(["tally", "margin"]);
    expect(entries?.[1]).toMatchObject({
      outcome: "stopped",
      reason: "the run was killed outright",
    });
  });

  it("settle_killed_writes_a_record_when_none_is_open", () => {
    const root = makeTempDir("active-run-log-none-");

    new RunLogAdapter(nodeIo()).settleKilled(root, {
      runId: RUN_ID,
      startedAt: new Date().toISOString(),
      startedBy: "app",
      running: ["tally"],
    });

    const records = logRecords(root);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: "scan",
      outcome: "stopped",
      exit: 1,
    });
    expect(
      records[0]?.phases?.flatMap((phase) => phase.entries)[0],
    ).toMatchObject({ name: "tally", outcome: "stopped" });
  });

  it("settling_the_same_killed_run_twice_writes_one_record", () => {
    const root = makeTempDir("active-run-log-twice-");
    const killed = {
      runId: RUN_ID,
      startedAt: new Date().toISOString(),
      startedBy: "app",
      running: ["tally"],
    };
    const adapter = new RunLogAdapter(nodeIo());

    adapter.settleKilled(root, killed);
    adapter.settleKilled(root, killed);
    new RunLogAdapter(nodeIo()).settleKilled(root, killed);

    expect(logRecords(root)).toHaveLength(1);
  });

  it("settle_killed_leaves_an_old_failed_record_alone", () => {
    const root = makeTempDir("active-run-log-old-failed-");
    const directory = logDirectory(root);
    const old = join(directory, "20200101T000000000Z-scan.json");
    const text = readFileSync(
      join(REPO, "schema/log-examples/valid/scan-phases-killed-failed.json"),
      "utf8",
    );

    mkdirSync(directory, { recursive: true });
    writeFileSync(old, text);

    new RunLogAdapter(nodeIo()).settleKilled(root, {
      runId: RUN_ID,
      startedAt: new Date().toISOString(),
      startedBy: "cli",
      running: ["tally"],
    });

    const records = logRecords(root);

    expect(records).toHaveLength(2);
    expect(records.map(({ outcome }) => outcome)).toEqual([
      "failed",
      "stopped",
    ]);
    expect(readFileSync(old, "utf8")).toBe(text);
  });

  it("an_unreadable_marker_deletes_nothing", () => {
    const root = makeTempDir("active-run-unreadable-");
    const path = marker(root);

    writeFileSync(path, "{ not json");

    const adapter = new ActiveRunAdapter(nodeIo());
    const read = adapter.read(root, null);

    expect(read.kind).toBe("unreadable");
    expect(() =>
      adapter.settleKilled(root, {
        runId: RUN_ID,
        startedBy: "cli",
        startedAt: new Date().toISOString(),
        scope: { kind: "working-tree" },
        sensors: [],
        describe: false,
        suites: {},
        phase: "running",
        endedAt: null,
        exit: null,
      }),
    ).toThrow();
    expect(readFileSync(path, "utf8")).toBe("{ not json");
    expect(existsSync(progressPath(root))).toBe(true);
  });

  it("an_unparseable_progress_line_is_counted_and_skipped", () => {
    const root = makeTempDir("active-run-lines-");

    marker(
      root,
      {},
      [
        "this is not json\n",
        line({ event: "start", phase: "sense", name: "tally" }),
        line({
          event: "plugin",
          phase: "sense",
          name: "tally",
          data: { event: "progress", done: "two" },
        }),
      ].join(""),
    );

    const read = new ActiveRunAdapter(nodeIo()).read(root, null);

    if (read.kind !== "live") {
      throw new Error(`expected live, read ${read.kind}`);
    }

    expect(read.reports).toEqual([
      { kind: "unreadable" },
      { kind: "plugin-started", name: "tally", progress: null },
      { kind: "unreadable" },
    ]);
  });

  function liveReports(progress: string[]) {
    const root = makeTempDir("active-run-reports-");

    marker(root, {}, progress.join(""));

    const read = new ActiveRunAdapter(nodeIo()).read(root, null);

    if (read.kind !== "live") {
      throw new Error(`expected live, read ${read.kind}`);
    }

    return read.reports;
  }

  const sense = (name: string, data: unknown) =>
    line({ event: "plugin", phase: "sense", name, data });
  const entry = (outcome: string, extra: Record<string, unknown> = {}) =>
    line({
      event: "entry",
      phase: "sense",
      name: "tally",
      outcome,
      ...extra,
    });

  it("maps_stage_and_estimate_lines_to_reports", () => {
    expect(
      liveReports([
        sense("tally", { event: "stage", name: "Coverage", index: 1, of: 2 }),
        sense("tally", { event: "estimate", remaining_ms: 5000 }),
        sense("tally", { event: "estimate", remaining_ms: null }),
      ]),
    ).toEqual([
      {
        kind: "plugin-stage",
        name: "tally",
        stage: { name: "Coverage", index: 1, of: 2 },
      },
      { kind: "plugin-estimate", name: "tally", estimateMs: 5000 },
      { kind: "plugin-estimate", name: "tally", estimateMs: null },
    ]);
  });

  it("a_malformed_stage_line_is_counted_and_skipped", () => {
    expect(
      liveReports([
        sense("tally", { event: "stage", name: "", index: 1, of: 2 }),
        sense("tally", { event: "stage", index: 1 }),
        sense("tally", { event: "estimate", remaining_ms: "soon" }),
        sense("tally", { event: "estimate", remaining_ms: 10 }),
      ]),
    ).toEqual([
      { kind: "unreadable" },
      { kind: "unreadable" },
      { kind: "unreadable" },
      { kind: "plugin-estimate", name: "tally", estimateMs: 10 },
    ]);
  });

  it("a_failed_entry_carries_its_reason_and_diagnosis", () => {
    const diagnosis = { code: "no-tests", line: "none ran" };

    expect(
      liveReports([entry("failed", { reason: "no tests ran", diagnosis })]),
    ).toEqual([
      {
        kind: "plugin-ended",
        name: "tally",
        state: "failed",
        failure: { reason: "no tests ran", diagnosis },
      },
    ]);
  });

  it("a_failed_entry_without_a_reason_reads_no_reason_was_recorded", () => {
    expect(
      liveReports([entry("failed"), entry("failed", { reason: "" })]),
    ).toEqual([
      {
        kind: "plugin-ended",
        name: "tally",
        state: "failed",
        failure: { reason: "no reason was recorded", diagnosis: null },
      },
      {
        kind: "plugin-ended",
        name: "tally",
        state: "failed",
        failure: { reason: "no reason was recorded", diagnosis: null },
      },
    ]);
  });

  it("an_ended_marker_carries_gaps_failure_and_ran", () => {
    const root = makeTempDir("active-run-ended-");
    const gaps = [{ id: "g", line: "a gap", needs: ["a thing"] }];
    const failure = {
      sensor: "tally",
      suite: null,
      code: null,
      reason: "it broke",
    };

    marker(root, {
      phase: "failed",
      ended_at: new Date().toISOString(),
      exit: 1,
      pid: deadPid(),
      gaps,
      failure,
      ran: ["sense"],
    });

    const read = new ActiveRunAdapter(nodeIo()).read(root, null);

    if (read.kind !== "ended") {
      throw new Error(`expected ended, read ${read.kind}`);
    }

    expect(read.record.gaps).toEqual(gaps);
    expect(read.record.failure).toEqual(failure);
    expect(read.record.ran).toEqual(["sense"]);
  });

  it("registry_over_this_repositorys_committed_config_lists_its_registered_sensors", () => {
    const root = makeTempDir("active-run-config-");
    const source = join(REPO, ".recognizer", "config.yaml");

    mkdirSync(join(root, ".recognizer"), { recursive: true });
    copyFileSync(source, join(root, ".recognizer", "config.yaml"));

    const committed = Object.keys(
      (parse(readFileSync(source, "utf8")) as { sensors: object }).sensors,
    );

    expect(committed.length).toBeGreaterThan(0);

    const config = new ConfigAdapter(nodeIo(), "all");
    const names = config
      .registeredSensors(config.sensorConfig(root))
      .map(({ name }) => name);
    const registry = SensorRegistry.read(names, {
      readable: new Map(),
      unreadable: new Map(),
    });

    expect(registry.entries.map(({ name }) => name)).toEqual(committed);
    expect(registry.entries).toHaveLength(2);
    expect(registry.entries.map(({ name }) => name)).toEqual([
      "crap",
      "mutation",
    ]);

    for (const entry of registry.entries) {
      expect(entry).toMatchObject({ manifest: null, registered: true });
    }

    expect(registry.catalog.state).toBe("read");
  });
});
