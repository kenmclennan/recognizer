import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { serialiseView } from "../src/index.js";
import { writeScopeFiles } from "../src/serve/scan-files.js";
import { plannedWorkFrom, workArgs } from "../src/serve/sensor-work.js";
import { parseStart } from "../src/serve/start-request.js";
import {
  ACTIVE_POLL_MS,
  IDLE_POLL_MS,
  newWatchState,
  pollInterval,
  watchTick,
} from "../src/serve/watch.js";
import { parseRequest } from "../src/serve/wire.js";
import { REPO } from "./helpers.js";
import {
  committedScan,
  FakeIo,
  holdingScanner,
  languagePrograms,
  plantMarkerIn,
  REPOSITORY,
  seedTypescriptRepository,
  sensorProgram,
  serveRoot,
  shippedSensor,
  typescriptScanner,
  typescriptScenario,
} from "./support/index.js";

function cacheOf(repository: string): string {
  return `${repository}/.recognizer/cache`;
}

const startOf = (repository: string, extra: Record<string, unknown> = {}) => ({
  repository,
  describe: false,
  analysis: true,
  sense: [],
  ...extra,
});

function ticks(over: Record<string, unknown> = {}) {
  return {
    describe: false,
    analysis: true,
    ticked: [],
    armed: [],
    onlyView: false,
    suites: {},
    folds: [],
    ...over,
  };
}

describe("recognizer serve: starting a scan", () => {
  it("a_start_request_builds_the_scan_request_the_flags_make", () => {
    const start = parseStart({
      repository: "/repo",
      describe: "stale",
      analysis: false,
      sense: ["crap", "mutation"],
      suites: { mutation: ["unit"] },
    });

    expect(start.request).toMatchObject({
      repository: "/repo",
      describe: "stale",
      analysis: false,
      sensors: [{ name: "crap" }, { name: "mutation", suites: ["unit"] }],
    });
    expect(start.flags).toEqual([
      "--json",
      "--describe",
      "--sense",
      "crap,mutation",
      "--skip-analysis",
    ]);
  });

  it("a_describe_all_start_asks_for_describe_all_with_the_modules", () => {
    const start = parseStart({
      repository: "/repo",
      describe: "all",
      analysis: true,
      sense: [],
      modules: ["a", "b"],
    });

    expect(start.request.describe).toBe("all");
    expect(start.flags).toContain("--describe=all");
    expect(start.modules).toEqual(["a", "b"]);
  });

  it("the_suites_scope_file_is_written_for_the_run_and_removed_after_it", () => {
    const io = new FakeIo();
    const files = writeScopeFiles(io, REPOSITORY, "scan", undefined, {
      crap: ["unit"],
    });

    expect(io.exists(files.suites as string)).toBe(true);
    expect(JSON.parse(io.readFile(files.suites as string))).toEqual({
      crap: ["unit"],
    });

    files.remove();

    expect(io.exists(files.suites as string)).toBe(false);
  });

  it("an_empty_suites_map_writes_no_file", () => {
    const start = parseStart({
      repository: "/repo",
      describe: false,
      sense: [],
      suites: {},
    });

    expect(start.suites).toBeUndefined();
  });
});

describe("recognizer serve: the watch", () => {
  function running(
    io: FakeIo,
    changes: Record<string, unknown> = {},
    lines: string[] = ['{"a":1}', '{"a":2}'],
  ): string {
    io.alive.add(io.pid());
    plantMarkerIn(
      io.files,
      REPOSITORY,
      {
        pid: io.pid(),
        pgid: io.pid(),
        started_at: new Date().toISOString(),
        ...changes,
      },
      lines,
    );

    return REPOSITORY;
  }

  function replant(
    io: FakeIo,
    changes: Record<string, unknown>,
    lines: string[],
  ): void {
    plantMarkerIn(
      io.files,
      REPOSITORY,
      { pid: io.pid(), started_at: new Date().toISOString(), ...changes },
      lines,
    );
  }

  it("a_watch_poll_runs_every_quarter_second_while_a_scan_is_active_and_every_second_otherwise", () => {
    const state = newWatchState();

    expect(pollInterval(state)).toBe(IDLE_POLL_MS);

    const io = new FakeIo();
    const repository = running(io);

    watchTick(io, repository, state);

    expect(pollInterval(state)).toBe(ACTIVE_POLL_MS);
    expect(ACTIVE_POLL_MS).toBe(250);
    expect(IDLE_POLL_MS).toBe(1000);
  });

  it("a_watch_replays_a_new_run_id_from_the_start", () => {
    const io = new FakeIo();
    const repository = running(io, { run_id: "run-1" }, ["x", "y"]);
    const state = newWatchState();

    expect(
      watchTick(io, repository, state).filter((item) => "line" in item),
    ).toHaveLength(2);
    expect(watchTick(io, repository, state)).toEqual([]);

    replant(io, { run_id: "run-2" }, ["z"]);

    expect(
      watchTick(io, repository, state)
        .filter((item) => "line" in item)
        .map((item) => (item as { line: string }).line),
    ).toEqual(["z"]);
  });

  it("a_watch_emits_a_terminal_record_after_the_lines_that_ended_the_run", () => {
    const io = new FakeIo();
    const repository = running(io, {}, ["x"]);
    const state = newWatchState();

    watchTick(io, repository, state);
    replant(
      io,
      {
        phase: "finished",
        ended_at: new Date().toISOString(),
        exit: 0,
        commit: "abc1234",
        ran: ["extract"],
      },
      ["x", "y"],
    );

    const items = watchTick(io, repository, state);

    expect(items.map((item) => ("line" in item ? "line" : "run"))).toEqual([
      "line",
      "run",
    ]);
  });

  it("a_watch_emits_an_active_record_before_its_lines", () => {
    const io = new FakeIo();
    const repository = running(io);
    const items = watchTick(io, repository, newWatchState());

    expect(items.map((item) => ("line" in item ? "line" : "run"))).toEqual([
      "run",
      "line",
      "line",
    ]);
  });

  it("a_watch_post_exit_tick_emits_the_terminal_record_and_trailing_lines_once", () => {
    const io = new FakeIo();
    const repository = running(io, {}, ["x"]);
    const state = newWatchState();

    watchTick(io, repository, state);
    replant(
      io,
      {
        phase: "finished",
        ended_at: new Date().toISOString(),
        exit: 0,
        commit: "abc1234",
        ran: ["extract"],
      },
      ["x", "tail"],
    );

    expect(watchTick(io, repository, state)).toHaveLength(2);
    expect(watchTick(io, repository, state)).toEqual([]);
  });

  it("a_watch_of_a_finished_run_seen_first_emits_its_record_but_not_its_lines", () => {
    const io = new FakeIo();
    const repository = running(
      io,

      {
        phase: "finished",
        ended_at: new Date().toISOString(),
        exit: 0,
        commit: "abc1234",
        ran: ["extract"],
      },
      ["x", "y"],
    );
    const items = watchTick(io, repository, newWatchState());

    expect(items).toHaveLength(1);
    expect("run" in (items[0] as object)).toBe(true);
  });
});

describe("recognizer serve: sensor work", () => {
  it("sensor_work_reads_the_unit_and_count_from_the_sensor_check", () => {
    expect(
      plannedWorkFrom(
        JSON.stringify({
          sensors: [{ work: { unit: "functions", to_perform: 12 } }],
        }),
      ),
    ).toEqual({ unit: "functions", to_perform: 12 });
  });

  it("sensor_work_with_no_work_line_or_a_bad_count_is_null", () => {
    expect(plannedWorkFrom("not json")).toBeNull();
    expect(plannedWorkFrom(JSON.stringify({ sensors: [{}] }))).toBeNull();
    expect(
      plannedWorkFrom(
        JSON.stringify({ sensors: [{ work: { unit: "f", to_perform: -1 } }] }),
      ),
    ).toBeNull();
    expect(
      plannedWorkFrom(
        JSON.stringify({ sensors: [{ work: { unit: "", to_perform: 1 } }] }),
      ),
    ).toBeNull();
  });

  it("sensor_work_passes_the_scope_files_only_when_given", () => {
    expect(workArgs("/r", "crap", undefined, undefined)).toEqual([
      "check",
      "crap",
      "--work",
      "--json",
      "--repository",
      "/r",
    ]);
    expect(workArgs("/r", "crap", "/m.json", "/s.json")).toEqual([
      "check",
      "crap",
      "--work",
      "--json",
      "--repository",
      "/r",
      "--modules",
      "/m.json",
      "--suites",
      "/s.json",
    ]);
  });
});

describe("recognizer serve: the wire", () => {
  it("a_malformed_line_gets_an_error_reply", async () => {
    const malformed = parseRequest("this is not json");
    const withId = parseRequest(
      JSON.stringify({ id: 4, op: "scan.status", args: [] }),
    );

    expect(malformed).toMatchObject({ ok: false, id: null });
    expect(withId).toMatchObject({ ok: false, id: 4 });
    expect(typeof (withId as { error: string }).error).toBe("string");

    const { root } = typescriptScenario();

    expect(
      (await root.call("scan.status", { repository: REPOSITORY })).ok,
    ).toEqual({
      running: false,
    });

    await root.close();
  });

  it("a_scan_stream_carries_only_its_outcome", async () => {
    const { root, repository } = typescriptScenario();
    const started = await root.call("scan.start", startOf(repository));

    await root.outcome(started.ok);

    const stream = root.lines.filter((line) => line.stream === started.ok);

    expect(stream.map((line) => Object.keys(line).sort())).toEqual([
      ["outcome", "stream"],
    ]);

    await root.close();
  });

  it("an_unknown_op_gets_an_error_reply", async () => {
    const parsed = parseRequest(
      JSON.stringify({ id: 1, op: "scan.nothing", args: {} }),
    );

    expect(parsed).toMatchObject({ ok: false, id: 1 });
    expect((parsed as { error: string }).error).toContain("unknown op");
  });

  it("every_op_is_answered", async () => {
    const { root, repository } = typescriptScenario();
    const started = await root.call(
      "scan.start",
      startOf(repository, { analysis: false }),
    );

    expect(typeof started.ok).toBe("string");
    expect((await root.outcome(started.ok)).status).toBe("finished");

    const status = await root.call("scan.status", { repository });

    expect(status.ok).toEqual({ running: false });

    const watch = await root.call("scan.watch", { repository });

    expect(typeof watch.ok).toBe("string");
    expect((await root.call("scan.unwatch", { watch: watch.ok })).ok).toBe(
      null,
    );

    const plan = await root.call("scan.plan", {
      repository,
      mode: "bring",
      ticks: ticks(),
      scope: null,
      changed: [],
    });

    expect(plan.ok).toHaveProperty("intent");
    expect((await root.call("scan.stop", { repository })).ok).toBe(null);
    expect(
      (await root.call("confirm.answer", { repository, describe: true })).error,
    ).toBe("no scan is waiting for an answer");
    expect(
      (await root.call("sensor.work", { repository, sensor: "crap" })).ok,
    ).toBe(null);

    await root.close();
  });
});

describe("recognizer serve: saved views", () => {
  it("view_parse_and_serialise_reply_over_the_wire", async () => {
    const { root } = typescriptScenario();
    const text = readFileSync(
      join(REPO, "schema/view-examples/valid/version-4-notes.json"),
      "utf8",
    );
    const parsed = await root.call("view.parse", { text });

    expect(parsed.ok).toMatchObject({ ok: true });

    const view = (parsed.ok as { view: Record<string, unknown> }).view;

    expect(view).toEqual(JSON.parse(text));

    const bad = await root.call("view.parse", { text: "{ not json" });

    expect(bad.ok).toMatchObject({ ok: false });
    expect((bad.ok as { reason: string }).reason).toContain("not valid JSON");

    const serialised = await root.call("view.serialise", { view });

    expect(serialised.ok).toEqual({ text: serialiseView(view as never) });

    await root.close();
  });
});

describe("recognizer serve: starting a scan, in process", () => {
  it("a_locked_repository_is_refused_through_the_service", async () => {
    const { root, repository } = typescriptScenario();

    root.io.alive.add(root.io.pid());
    plantMarkerIn(root.io.files, repository, {
      pid: root.io.pid(),
      pgid: root.io.pid(),
      started_by: "cli",
      started_at: new Date().toISOString(),
    });

    const started = await root.call("scan.start", startOf(repository));

    expect(await root.outcome(started.ok)).toEqual({
      status: "refused",
      reason: "lock",
    });

    const status = (await root.call("scan.status", { repository })).ok;

    expect(status.running).toBe(true);
    expect(status.startedBy).toBe("cli");
    expect(typeof status.refusal).toBe("string");

    await root.close();
  });

  it("the_module_scope_file_is_written_for_the_run_and_removed_after_it", async () => {
    const held = holdingScanner();
    const { root, repository } = typescriptScenario({
      programs: { "recognizer-scan-typescript": held.program },
    });
    const started = await root.call(
      "scan.start",
      startOf(repository, { analysis: false, modules: ["sample"] }),
    );

    await root.until(() => held.runs.get(repository));

    const named = () =>
      root.io.files
        .readDir(cacheOf(repository))
        .map((entry) => entry.name)
        .filter((name) => name.startsWith("serve-scan-modules-"));

    expect(named()).toHaveLength(1);
    expect(
      JSON.parse(
        root.io.files.readFile(`${cacheOf(repository)}/${named()[0]}`),
      ),
    ).toEqual(["sample"]);

    held.release();
    await root.outcome(started.ok);

    expect(
      root.io.files
        .readDir(cacheOf(repository))
        .filter((entry) => entry.name.startsWith("serve-scan-")),
    ).toEqual([]);

    await root.close();
  });

  it("a_failed_scoped_run_removes_the_module_file", async () => {
    const failing = holdingScanner({ fails: true, held: false });
    const { root, repository } = typescriptScenario({
      programs: { "recognizer-scan-typescript": failing.program },
    });
    const started = await root.call(
      "scan.start",
      startOf(repository, { analysis: false, modules: ["sample"] }),
    );

    expect((await root.outcome(started.ok)).status).not.toBe("finished");
    expect(
      root.io.files
        .readDir(cacheOf(repository))
        .filter((entry) => entry.name.startsWith("serve-scan-")),
    ).toEqual([]);

    await root.close();
  });
});

describe("recognizer serve: sensor refusals", () => {
  it("reports a refused sensor as an invalid request", async () => {
    const { root, repository } = typescriptScenario();
    const started = await root.call(
      "scan.start",
      startOf(repository, { analysis: false, sense: ["ghost"] }),
    );
    const outcome = await root.outcome(started.ok);

    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toBe("invalid-request");
    expect(outcome.messages.join("\n")).toContain("no such sensor: ghost");

    await root.close();
  });
});

describe("recognizer serve: stopping", () => {
  function twoRepositories() {
    const held = holdingScanner();
    const { root, repository } = typescriptScenario({
      programs: { "recognizer-scan-typescript": held.program },
    });
    const second = "/second";

    seedTypescriptRepository(root.io.files, second);
    root.repositories.commitAll(second);

    return { held, root, first: repository, second };
  }

  it("stop_ends_the_scan_and_its_plugins", async () => {
    const held = holdingScanner();
    const { root, repository } = typescriptScenario({
      programs: { "recognizer-scan-typescript": held.program },
    });
    const started = await root.call(
      "scan.start",
      startOf(repository, { analysis: false }),
    );
    const plugin = await root.until(() => held.runs.get(repository));

    expect(plugin.killed).toBe(false);
    expect((await root.call("scan.stop", { scan: started.ok })).ok).toBe(null);
    expect((await root.outcome(started.ok)).status).toBe("stopped");
    await root.until(() => (plugin.killed ? true : undefined));

    await root.close();
  });

  it("stopping_one_scan_leaves_the_other_running", async () => {
    const { held, root, first, second } = twoRepositories();
    const one = await root.call(
      "scan.start",
      startOf(first, { analysis: false }),
    );
    const two = await root.call(
      "scan.start",
      startOf(second, { analysis: false }),
    );
    const firstPlugin = await root.until(() => held.runs.get(first));
    const secondPlugin = await root.until(() => held.runs.get(second));

    await root.call("scan.stop", { scan: one.ok });

    expect((await root.outcome(one.ok)).status).toBe("stopped");
    await root.until(() => (firstPlugin.killed ? true : undefined));

    expect(secondPlugin.killed).toBe(false);
    expect(root.io.files.exists(`${cacheOf(second)}/scan-running.json`)).toBe(
      true,
    );
    expect(
      JSON.parse(root.io.files.readFile(`${cacheOf(second)}/scan-running.json`))
        .phase,
    ).not.toBe("stopped");

    held.release();

    expect((await root.outcome(two.ok)).status).toBe("finished");

    await root.close();
  });

  it("stopping_one_scan_keeps_the_other_scans_temp_directories", async () => {
    const { held, root, first, second } = twoRepositories();
    const one = await root.call(
      "scan.start",
      startOf(first, { analysis: false }),
    );

    await root.call("scan.start", startOf(second, { analysis: false }));

    const firstPlugin = await root.until(() => held.runs.get(first));
    const secondPlugin = await root.until(() => held.runs.get(second));
    const directoryOf = (output: string) => output.replace(/\/[^/]*$/, "");

    expect(root.io.files.exists(directoryOf(firstPlugin.output))).toBe(true);
    expect(root.io.files.exists(directoryOf(secondPlugin.output))).toBe(true);

    await root.call("scan.stop", { scan: one.ok });
    await root.outcome(one.ok);

    expect(root.io.files.exists(directoryOf(firstPlugin.output))).toBe(false);
    expect(root.io.files.exists(directoryOf(secondPlugin.output))).toBe(true);

    await root.close();
  });

  it("stopping_while_waiting_for_an_answer_ends_the_scan", async () => {
    const held = holdingScanner();
    const { root, repository } = typescriptScenario({
      programs: { "recognizer-scan-typescript": held.program },
    });
    const started = await root.call(
      "scan.start",
      startOf(repository, { analysis: false }),
    );

    await root.until(() => held.runs.get(repository));
    await root.call("scan.stop", { scan: started.ok });

    expect((await root.outcome(started.ok)).status).toBe("stopped");

    await root.close();
  });
});

describe("recognizer serve: the watch, in process", () => {
  it("a_watch_of_a_repository_with_no_marker_emits_a_null_run", async () => {
    const { root, repository } = typescriptScenario();
    const watch = await root.call("scan.watch", { repository });
    const item = await root.until(() =>
      root.lines.find((line) => line.stream === watch.ok && "run" in line),
    );

    expect(item.run).toBeNull();

    await root.close();
  });

  it("a_watch_of_a_live_run_from_another_process_is_read_with_its_progress_replayed", async () => {
    const { root, repository } = typescriptScenario();

    root.io.alive.add(root.io.pid());
    plantMarkerIn(
      root.io.files,
      repository,
      {
        pid: root.io.pid(),
        pgid: root.io.pid(),
        started_at: new Date().toISOString(),
      },
      ['{"a":1}', '{"a":2}'],
    );

    const watch = await root.call("scan.watch", { repository });

    await root.until(() =>
      root.lines.filter((line) => line.stream === watch.ok && "line" in line)
        .length === 2
        ? true
        : undefined,
    );

    const items = root.lines.filter((line) => line.stream === watch.ok);

    expect(items[0]?.run.phase).toBe("running");
    expect(items.slice(1).map((item) => item.line)).toEqual([
      '{"a":1}',
      '{"a":2}',
    ]);

    await root.close();
  });

  it("a_watch_ends_after_scan_unwatch_and_no_further_item_arrives", async () => {
    const { root, repository } = typescriptScenario();
    const watch = await root.call("scan.watch", { repository });

    await root.until(() =>
      root.lines.find((line) => line.stream === watch.ok && "run" in line),
    );
    await root.call("scan.unwatch", { watch: watch.ok });

    const before = root.lines.length;

    plantMarkerIn(root.io.files, repository, { pid: root.io.pid() });
    await root.advance(IDLE_POLL_MS * 2);

    expect(root.lines.length).toBe(before);

    await root.close();
  });
});

describe("recognizer serve: confirm answers", () => {
  const answerPathOf = (repository: string) =>
    `${cacheOf(repository)}/scan-running.answer.json`;

  function waiting(runId: string) {
    const scenario = typescriptScenario();

    scenario.root.io.alive.add(scenario.root.io.pid());
    plantMarkerIn(scenario.root.io.files, scenario.repository, {
      pid: scenario.root.io.pid(),
      pgid: scenario.root.io.pid(),
      run_id: runId,
      started_at: new Date().toISOString(),
    });

    return scenario;
  }

  it("confirm_answer_writes_one_answer_for_the_live_run", async () => {
    const { root, repository } = waiting("run-1");

    expect(
      (await root.call("confirm.answer", { repository, describe: true })).ok,
    ).toBe(null);
    expect(
      JSON.parse(root.io.files.readFile(answerPathOf(repository))),
    ).toEqual({ version: 1, run_id: "run-1", describe: true });
    expect(
      (await root.call("confirm.answer", { repository, describe: false }))
        .error,
    ).toBe("this scan was already answered");

    await root.close();
  });

  it("confirm_answer_writes_the_answer_for_a_new_run_over_a_stale_one", async () => {
    const { root, repository } = waiting("run-2");

    root.io.files.writeFile(
      answerPathOf(repository),
      JSON.stringify({ version: 1, run_id: "run-1", describe: false }),
    );

    expect(
      (await root.call("confirm.answer", { repository, describe: true })).ok,
    ).toBe(null);
    expect(
      JSON.parse(root.io.files.readFile(answerPathOf(repository))).run_id,
    ).toBe("run-2");

    await root.close();
  });

  it("confirm_answer_refuses_without_a_live_running_record", async () => {
    const { root, repository } = typescriptScenario();

    expect(
      (await root.call("confirm.answer", { repository, describe: true })).error,
    ).toBe("no scan is waiting for an answer");
    expect(root.io.files.exists(answerPathOf(repository))).toBe(false);

    await root.close();
  });
});

describe("recognizer serve: plans", () => {
  function plannable(registered: string[]) {
    const scenario = typescriptScenario({
      registered,
      programs: Object.fromEntries(
        registered.map((name) => [
          `recognizer-sense-${name}`,
          shippedSensor(name),
        ]),
      ),
    });

    scenario.root.io.files.writeFile(
      `${cacheOf(scenario.repository)}/scan.typescript.json`,
      JSON.stringify(committedScan()),
    );

    return scenario;
  }

  it("a_plan_through_the_service_drops_unregistered_ticked_names", async () => {
    const { root, repository } = plannable(["crap"]);
    const plan = (
      await root.call("scan.plan", {
        repository,
        mode: "bring",
        ticks: ticks({ ticked: ["crap", "nonesuch"], armed: ["crap"] }),
        scope: null,
        changed: [],
      })
    ).ok;

    expect(plan.intent.sense).toEqual(["crap"]);
    expect(plan.dropped).toEqual(["nonesuch"]);

    await root.close();
  });

  it("a_plan_over_the_committed_typescript_scan", async () => {
    const shipped = JSON.parse(
      readFileSync(join(REPO, "fixtures/sensors/shipped.json"), "utf8"),
    ) as string[];
    const expected = committedScan() as { modules: unknown[] };
    const { root, repository } = plannable(shipped);

    expect(expected.modules.length).toBeGreaterThan(0);

    const plan = (
      await root.call("scan.plan", {
        repository,
        mode: "bring",
        ticks: ticks({ armed: shipped }),
        scope: null,
        changed: [],
      })
    ).ok;

    expect(plan.never).toEqual(shipped);

    for (const name of shipped) {
      expect(plan.work[name]).toBe(expected.modules.length);
    }

    await root.close();
  });
});

describe("recognizer serve: tests hash", () => {
  const WORKED =
    "9a49fc96a1cf8fd7663d83897d346b14a4f4de85c8114981854191414ab6df5a";
  const WORKED_FILES = {
    "tests/a.py": "a",
    "tests/b.py": "b",
    "src/app.py": "x",
  };
  const FIXTURE_DIRECTORY = join(REPO, "fixtures/sensors/tests-digest");

  function hashing(programs: ReturnType<typeof languagePrograms>) {
    return serveRoot({ programs });
  }

  function gitRepository(root: ReturnType<typeof serveRoot>, path: string) {
    for (const [name, text] of Object.entries(WORKED_FILES)) {
      root.io.files.writeFile(`${path}/${name}`, text);
    }

    root.repositories.commitAll(path);
  }

  it("tests.hash replies with the digest of the repository's test files", async () => {
    const root = hashing(languagePrograms());

    gitRepository(root, "/work");

    const reply = await root.call("tests.hash", {
      repository: "/work",
      known: {},
    });

    expect(reply.ok).toBe(WORKED);

    await root.close();
  });

  it("tests.hash combines a scanner's tests report with the files' hashes", async () => {
    const expected = JSON.parse(
      readFileSync(join(FIXTURE_DIRECTORY, "expected.json"), "utf8"),
    ) as { digest: string; entries: Record<string, string> };
    const own = Object.fromEntries(
      Object.entries(expected.entries).filter(([key]) => key.includes("#")),
    );
    const root = hashing(languagePrograms({ entries: own }));

    root.io.files.seedFrom(join(FIXTURE_DIRECTORY, "rust-in-file"), "/rust");
    root.repositories.commitAll("/rust");

    const reply = await root.call("tests.hash", {
      repository: "/rust",
      known: {},
    });

    expect(own).not.toEqual({});
    expect(reply.ok).toBe(expected.digest);

    await root.close();
  });

  it("tests.hash gives a non-git folder a digest from the filesystem listing and is null when a scanner's answer fails", async () => {
    const plain = hashing(languagePrograms());
    const failing = hashing(languagePrograms({ entries: {}, status: 1 }));

    plain.io.files.writeFile("/outside/tests/a.py", "a");
    gitRepository(failing, "/work");

    const notGit = await plain.call("tests.hash", {
      repository: "/outside",
      known: {},
    });
    const failed = await failing.call("tests.hash", {
      repository: "/work",
      known: {},
    });

    expect(typeof notGit.ok).toBe("string");
    expect(failed.ok).toBeNull();
    expect("ok" in failed).toBe(true);

    await plain.close();
    await failing.close();
  });

  it("tests.hash refuses a known that is not an object of strings", async () => {
    const root = hashing(languagePrograms());

    gitRepository(root, "/work");

    const asList = await root.call("tests.hash", {
      repository: "/work",
      known: [],
    });
    const asNumber = await root.call("tests.hash", {
      repository: "/work",
      known: { a: 1 },
    });

    expect(typeof asList.error).toBe("string");
    expect(asList).not.toHaveProperty("ok");
    expect(typeof asNumber.error).toBe("string");
    expect(asNumber).not.toHaveProperty("ok");

    await root.close();
  });
});

describe("the service built in process", () => {
  it("a_service_built_in_process_touches_nothing_under_the_real_tmpdir", async () => {
    const realTmpdir = process.env.TMPDIR;
    const watched = makeTempDir("serve-tmpdir-guard-");

    process.env.TMPDIR = watched;

    try {
      const root = serveRoot({
        programs: {
          "recognizer-scan-typescript": typescriptScanner(),
          "recognizer-sense-crap": sensorProgram("crap"),
        },
      });
      const repository = "/repo";

      root.io.files.writeFile(`${repository}/a.ts`, "one");
      root.io.files.writeFile(
        `${repository}/.gitignore`,
        ".recognizer/cache/\n",
      );
      root.io.files.writeFile(
        `${repository}/.recognizer/config.yaml`,
        "sensors:\n  crap: {}\n",
      );
      root.repositories.commitAll(repository);

      const started = await root.call("scan.start", {
        repository,
        describe: false,
        analysis: false,
        sense: ["crap"],
      });
      const outcome = await root.outcome(started.ok);

      expect(outcome.status).toBe("finished");
      expect(tmpdir()).toBe(watched);
      expect(readdirSync(watched)).toEqual([]);

      await root.close();
    } finally {
      process.env.TMPDIR = realTmpdir;
    }
  });

  it("a_scan_naming_two_sensors_with_one_program_missing_is_refused_naming_the_missing_one", async () => {
    const root = serveRoot({
      programs: { "recognizer-sense-crap": sensorProgram("crap") },
    });
    const repository = "/repo";

    root.io.files.writeFile(`${repository}/a.ts`, "one");
    root.io.files.writeFile(`${repository}/.gitignore`, ".recognizer/cache/\n");
    root.io.files.writeFile(
      `${repository}/.recognizer/config.yaml`,
      "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n  mine:\n    command: [recognizer-sense-mine, run]\n    manifest: [recognizer-sense-mine, manifest]\n",
    );
    root.repositories.commitAll(repository);

    const started = await root.call("scan.start", {
      repository,
      describe: false,
      analysis: false,
      sense: ["crap", "mine"],
    });
    const outcome = await root.outcome(started.ok);
    const ran = root.io.processes.calls
      .filter((call) => call.command !== "git")
      .map((call) => `${call.command} ${call.args[0]}`);

    expect(outcome.status).toBe("refused");
    expect(outcome.gaps).toEqual([
      {
        id: "sensors:missing:mine",
        line: "recognizer-sense-mine is not installed",
        needs: ["mine"],
      },
    ]);
    expect(ran).toContain("recognizer-sense-crap manifest");
    expect(ran.filter((call) => call.endsWith(" run"))).toEqual([]);

    await root.close();
  });
});
