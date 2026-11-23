import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import {
  parseViewFile,
  serialiseView,
} from "../src/adapters/filesystem/view-translator.js";
import { nodeIo } from "../src/cli.js";
import { progressPath } from "../src/scan-marker.js";
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
import { REPO } from "./helpers.js";
import {
  alive,
  BIN,
  failingLaunchers,
  pidFile,
  plantMarker,
  Serve,
  slowLaunchers,
  typescriptLaunchers,
  typescriptRepository,
} from "./serve-harness.js";

const TIMEOUT = scaledTimeout(60_000);

function release(gate: string): void {
  writeFileSync(join(gate, "release"), "");
}

function cacheOf(repository: string): string {
  return join(repository, ".recognizer", "cache");
}

function normalisedMarker(path: string): Record<string, unknown> {
  const marker = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    unknown
  >;

  return {
    ...marker,
    run_id: null,
    pid: null,
    pgid: null,
    started_at: null,
    ended_at: null,
    started_by: null,
    repository: null,
  };
}

function normalisedScan(path: string): Record<string, unknown> {
  return {
    ...(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>),
    scanner: null,
    commit: null,
  };
}

function logPhases(repository: string): string[] {
  const directory = join(cacheOf(repository), "log");
  const [file] = readdirSync(directory).sort();
  const record = JSON.parse(
    readFileSync(join(directory, file as string), "utf8"),
  ) as { phases?: { name: string }[] };

  return (record.phases ?? []).map(({ name }) => name);
}

describe("recognizer serve: the wire", () => {
  it(
    "a_malformed_line_gets_an_error_reply",
    async () => {
      const serve = new Serve(typescriptLaunchers());

      serve.raw("this is not json");
      serve.raw(JSON.stringify({ id: 4, op: "scan.status", args: [] }));

      const withId = await serve.until(() =>
        serve.lines.find((line) => line.id === 4),
      );

      expect(typeof withId.error).toBe("string");

      const lone = await serve.until(() =>
        serve.lines.find((line) => line.id === undefined && "error" in line),
      );

      expect(typeof lone.error).toBe("string");
      expect(
        (
          await serve.call("scan.status", {
            repository: typescriptRepository(),
          })
        ).ok,
      ).toEqual({ running: false });

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "an_unknown_op_gets_an_error_reply",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const reply = await serve.call("scan.nothing", {});

      expect(reply.error).toContain("unknown op");

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "every_op_is_answered",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = typescriptRepository();
      const started = await serve.call("scan.start", {
        repository,
        describe: false,
        analysis: true,
        sense: [],
      });

      expect(typeof started.ok).toBe("string");
      expect((await serve.outcome(started.ok)).status).toBe("finished");

      const status = await serve.call("scan.status", { repository });

      expect(status.ok).toEqual({ running: false });

      const watch = await serve.call("scan.watch", { repository });

      expect(typeof watch.ok).toBe("string");
      expect((await serve.call("scan.unwatch", { watch: watch.ok })).ok).toBe(
        null,
      );

      const plan = await serve.call("scan.plan", {
        repository,
        mode: "bring",
        ticks: {
          describe: false,
          analysis: true,
          ticked: [],
          armed: [],
          onlyView: false,
          suites: {},
          folds: [],
        },
        scope: null,
        changed: [],
      });

      expect(plan.ok).toHaveProperty("intent");
      expect((await serve.call("scan.stop", { repository })).ok).toBe(null);
      expect(
        (await serve.call("confirm.answer", { repository, describe: true }))
          .error,
      ).toBe("no scan is waiting for an answer");
      expect(
        (await serve.call("sensor.work", { repository, sensor: "crap" })).ok,
      ).toBe(null);

      await serve.close();
    },
    TIMEOUT,
  );
});

describe("recognizer serve: saved views", () => {
  it(
    "view_parse_and_serialise_reply_over_the_wire",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const text = readFileSync(
        join(REPO, "schema/view-examples/valid/version-4-notes.json"),
        "utf8",
      );
      const parsed = await serve.call("view.parse", { text });
      const expected = parseViewFile(text);

      expect(parsed.ok).toMatchObject({ ok: true });
      expect(expected.ok).toBe(true);

      const view = (parsed.ok as { view: Record<string, unknown> }).view;

      expect(view).toEqual(JSON.parse(text));

      const bad = await serve.call("view.parse", { text: "{ not json" });

      expect(bad.ok).toMatchObject({ ok: false });
      expect((bad.ok as { reason: string }).reason).toContain("not valid JSON");

      const serialised = await serve.call("view.serialise", { view });

      expect(serialised.ok).toEqual({
        text: serialiseView(
          parseViewFile(text).ok
            ? (expected as { view: never }).view
            : (view as never),
        ),
      });

      await serve.close();
    },
    TIMEOUT,
  );
});

describe("recognizer serve: starting a scan", () => {
  it(
    "a_scan_through_the_service_equals_the_cli_scan",
    async () => {
      const launchers = typescriptLaunchers();
      const viaService = typescriptRepository();
      const viaCli = typescriptRepository();
      const environment = { ...process.env };

      delete environment.RECOGNIZER_STARTED_BY;

      const cli = spawnSync(process.execPath, [BIN, "scan", viaCli, "--json"], {
        env: { ...environment, PATH: `${launchers}:${process.env.PATH}` },
        encoding: "utf8",
      });

      expect(cli.status).toBe(0);

      const serve = new Serve(launchers);
      const started = await serve.call("scan.start", {
        repository: viaService,
        describe: false,
        analysis: true,
        sense: [],
      });

      expect(await serve.outcome(started.ok)).toEqual({ status: "finished" });
      await serve.close();

      const marker = join(cacheOf(viaService), "scan-running.json");

      expect(JSON.parse(readFileSync(marker, "utf8")).started_by).toBe("app");
      expect(normalisedMarker(marker)).toEqual(
        normalisedMarker(join(cacheOf(viaCli), "scan-running.json")),
      );
      expect(
        normalisedScan(join(cacheOf(viaService), "scan.typescript.json")),
      ).toEqual(normalisedScan(join(cacheOf(viaCli), "scan.typescript.json")));
      expect(logPhases(viaService)).toEqual(logPhases(viaCli));
    },
    TIMEOUT,
  );

  it(
    "a_locked_repository_is_refused_through_the_service",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = typescriptRepository();

      plantMarker(repository, {
        pid: process.pid,
        pgid: process.pid,
        started_by: "cli",
        started_at: new Date().toISOString(),
      });

      const started = await serve.call("scan.start", {
        repository,
        describe: false,
        analysis: true,
        sense: [],
      });

      expect(await serve.outcome(started.ok)).toEqual({
        status: "refused",
        reason: "lock",
      });

      const status = (await serve.call("scan.status", { repository })).ok;

      expect(status.running).toBe(true);
      expect(status.startedBy).toBe("cli");
      expect(typeof status.refusal).toBe("string");

      await serve.close();
    },
    TIMEOUT,
  );

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

  it(
    "the_module_scope_file_is_written_for_the_run_and_removed_after_it",
    async () => {
      const gate = makeTempDir("serve-gate-");
      const serve = new Serve(slowLaunchers(gate));
      const repository = typescriptRepository();
      const started = await serve.call("scan.start", {
        repository,
        describe: false,
        analysis: false,
        sense: [],
        modules: ["sample"],
      });

      await pidFile(serve, gate, repository);

      const during = readdirSync(cacheOf(repository)).filter((name) =>
        name.startsWith("serve-scan-modules-"),
      );

      expect(during).toHaveLength(1);
      expect(
        JSON.parse(
          readFileSync(join(cacheOf(repository), during[0] as string), "utf8"),
        ),
      ).toEqual(["sample"]);

      release(gate);
      await serve.outcome(started.ok);

      expect(
        readdirSync(cacheOf(repository)).filter((name) =>
          name.startsWith("serve-scan-"),
        ),
      ).toEqual([]);

      await serve.close();
    },
    TIMEOUT,
  );

  it("the_suites_scope_file_is_written_for_the_run_and_removed_after_it", () => {
    const repository = typescriptRepository();
    const files = writeScopeFiles(repository, "scan", undefined, {
      crap: ["unit"],
    });

    expect(existsSync(files.suites as string)).toBe(true);
    expect(JSON.parse(readFileSync(files.suites as string, "utf8"))).toEqual({
      crap: ["unit"],
    });

    files.remove();

    expect(existsSync(files.suites as string)).toBe(false);
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

  it(
    "a_failed_scoped_run_removes_the_module_file",
    async () => {
      const serve = new Serve(failingLaunchers());
      const repository = typescriptRepository();
      const started = await serve.call("scan.start", {
        repository,
        describe: false,
        analysis: false,
        sense: [],
        modules: ["sample"],
      });

      expect((await serve.outcome(started.ok)).status).not.toBe("finished");
      expect(
        readdirSync(cacheOf(repository)).filter((name) =>
          name.startsWith("serve-scan-"),
        ),
      ).toEqual([]);

      await serve.close();
    },
    TIMEOUT,
  );
});

describe("recognizer serve: stopping", () => {
  it(
    "stop_ends_the_scan_and_its_plugins",
    async () => {
      const gate = makeTempDir("serve-gate-");
      const serve = new Serve(slowLaunchers(gate));
      const repository = typescriptRepository();
      const started = await serve.call("scan.start", {
        repository,
        describe: false,
        analysis: false,
        sense: [],
      });
      const plugin = await pidFile(serve, gate, repository);

      expect(alive(plugin)).toBe(true);
      expect((await serve.call("scan.stop", { scan: started.ok })).ok).toBe(
        null,
      );
      expect((await serve.outcome(started.ok)).status).toBe("stopped");
      await serve.until(() => (alive(plugin) ? undefined : true));

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "stopping_one_scan_leaves_the_other_running",
    async () => {
      const gate = makeTempDir("serve-gate-");
      const serve = new Serve(slowLaunchers(gate));
      const first = typescriptRepository();
      const second = typescriptRepository();
      const one = await serve.call("scan.start", {
        repository: first,
        describe: false,
        analysis: false,
        sense: [],
      });
      const two = await serve.call("scan.start", {
        repository: second,
        describe: false,
        analysis: false,
        sense: [],
      });
      const firstPlugin = await pidFile(serve, gate, first);
      const secondPlugin = await pidFile(serve, gate, second);

      await serve.call("scan.stop", { scan: one.ok });

      expect((await serve.outcome(one.ok)).status).toBe("stopped");
      await serve.until(() => (alive(firstPlugin) ? undefined : true));

      expect(alive(secondPlugin)).toBe(true);
      expect(existsSync(join(cacheOf(second), "scan-running.json"))).toBe(true);
      expect(
        JSON.parse(
          readFileSync(join(cacheOf(second), "scan-running.json"), "utf8"),
        ).phase,
      ).not.toBe("stopped");

      release(gate);

      expect((await serve.outcome(two.ok)).status).toBe("finished");

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "stopping_one_scan_keeps_the_other_scans_temp_directories",
    async () => {
      const gate = makeTempDir("serve-gate-");
      const serve = new Serve(slowLaunchers(gate));
      const first = typescriptRepository();
      const second = typescriptRepository();
      const one = await serve.call("scan.start", {
        repository: first,
        describe: false,
        analysis: false,
        sense: [],
      });

      await serve.call("scan.start", {
        repository: second,
        describe: false,
        analysis: false,
        sense: [],
      });
      await pidFile(serve, gate, first);
      await pidFile(serve, gate, second);

      const outputs = (repository: string) =>
        dirname(
          readFileSync(
            join(gate, `${repository.split("/").pop()}.out`),
            "utf8",
          ).trim(),
        );

      expect(existsSync(outputs(first))).toBe(true);
      expect(existsSync(outputs(second))).toBe(true);

      await serve.call("scan.stop", { scan: one.ok });
      await serve.outcome(one.ok);

      expect(existsSync(outputs(first))).toBe(false);
      expect(existsSync(outputs(second))).toBe(true);

      await serve.child.kill("SIGTERM");
      await serve.exited;
    },
    TIMEOUT,
  );

  it(
    "the_service_stops_every_scan_on_sigterm",
    async () => {
      const gate = makeTempDir("serve-gate-");
      const serve = new Serve(slowLaunchers(gate));
      const first = typescriptRepository();
      const second = typescriptRepository();

      for (const repository of [first, second]) {
        await serve.call("scan.start", {
          repository,
          describe: false,
          analysis: false,
          sense: [],
        });
      }

      const plugins = [
        await pidFile(serve, gate, first),
        await pidFile(serve, gate, second),
      ];

      serve.child.kill("SIGTERM");
      await serve.exited;

      for (const plugin of plugins) {
        expect(alive(plugin)).toBe(false);
      }
    },
    TIMEOUT,
  );

  it(
    "the_service_exits_and_stops_every_scan_when_its_stdin_closes",
    async () => {
      const gate = makeTempDir("serve-gate-");
      const serve = new Serve(slowLaunchers(gate));
      const first = typescriptRepository();
      const second = typescriptRepository();

      for (const repository of [first, second]) {
        await serve.call("scan.start", {
          repository,
          describe: false,
          analysis: false,
          sense: [],
        });
      }

      const plugins = [
        await pidFile(serve, gate, first),
        await pidFile(serve, gate, second),
      ];

      serve.child.stdin?.end();

      expect(await serve.exited).toBe(0);

      for (const plugin of plugins) {
        expect(alive(plugin)).toBe(false);
      }

      for (const repository of [first, second]) {
        const marker = join(cacheOf(repository), "scan-running.json");

        if (existsSync(marker)) {
          expect(JSON.parse(readFileSync(marker, "utf8")).phase).not.toBe(
            "running",
          );
        }
      }
    },
    TIMEOUT,
  );

  it(
    "stopping_while_waiting_for_an_answer_ends_the_scan",
    async () => {
      const gate = makeTempDir("serve-gate-");
      const serve = new Serve(slowLaunchers(gate));
      const repository = typescriptRepository();
      const started = await serve.call("scan.start", {
        repository,
        describe: false,
        analysis: false,
        sense: [],
      });

      await pidFile(serve, gate, repository);
      await serve.call("scan.stop", { scan: started.ok });

      expect((await serve.outcome(started.ok)).status).toBe("stopped");

      await serve.close();
    },
    TIMEOUT,
  );
});

function sleeper(script: string, detached: boolean) {
  return spawn("/bin/sh", ["-c", script], {
    detached,
    stdio: "ignore",
  });
}

describe("recognizer serve: stop by repository", () => {
  it(
    "stop_by_repository_stops_a_scan_the_service_holds",
    async () => {
      const gate = makeTempDir("serve-gate-");
      const serve = new Serve(slowLaunchers(gate));
      const repository = typescriptRepository();
      const started = await serve.call("scan.start", {
        repository,
        describe: false,
        analysis: false,
        sense: [],
      });

      await pidFile(serve, gate, repository);
      await serve.call("scan.stop", { repository, owner: "any" });

      expect((await serve.outcome(started.ok)).status).toBe("stopped");

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "stop_by_repository_signals_the_group_of_an_app_marker_from_another_process",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = typescriptRepository();
      const child = sleeper("sleep 60 & wait", true);
      const pid = child.pid as number;

      plantMarker(repository, { pid, pgid: 999_999, started_by: "app" });
      await serve.call("scan.stop", { repository, owner: "any" });
      await serve.until(() => (alive(pid) ? undefined : true));
      child.kill("SIGKILL");

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "stop_by_repository_signals_only_the_pid_of_a_cli_marker",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = typescriptRepository();
      const marker = makeTempDir("serve-grandchild-");
      const grandchild = join(marker, "pid");
      const child = sleeper(`sleep 60 & echo $! > ${grandchild}; wait`, false);
      const pid = child.pid as number;

      await serve.until(() =>
        existsSync(grandchild) && readFileSync(grandchild, "utf8").trim() !== ""
          ? true
          : undefined,
      );

      const other = Number(readFileSync(grandchild, "utf8").trim());

      plantMarker(repository, { pid, pgid: 999_999, started_by: "cli" });
      await serve.call("scan.stop", { repository, owner: "any" });
      await serve.until(() =>
        alive(pid) && child.exitCode === null ? undefined : true,
      );

      expect(alive(other)).toBe(true);

      process.kill(other, "SIGKILL");
      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "stop_by_repository_never_signals_a_marker_naming_the_service",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = typescriptRepository();

      plantMarker(repository, {
        pid: serve.child.pid,
        pgid: serve.child.pid,
        started_by: "app",
      });

      expect(
        (await serve.call("scan.stop", { repository, owner: "any" })).ok,
      ).toBe(null);
      expect(alive(serve.child.pid as number)).toBe(true);
      expect((await serve.call("scan.status", { repository })).ok.running).toBe(
        true,
      );

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "stop_by_repository_with_owner_app_skips_a_cli_marker",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = typescriptRepository();
      const child = sleeper("sleep 60", true);
      const pid = child.pid as number;

      plantMarker(repository, { pid, pgid: pid, started_by: "cli" });
      await serve.call("scan.stop", { repository, owner: "app" });

      expect(alive(pid)).toBe(true);

      child.kill("SIGKILL");
      await serve.close();
    },
    TIMEOUT,
  );
});

function writeProgress(repository: string, lines: string[]): void {
  writeFileSync(
    progressPath(repository),
    lines.map((line) => `${line}\n`).join(""),
  );
}

describe("recognizer serve: the watch", () => {
  function runningRepository(
    changes: Record<string, unknown> = {},
    lines: string[] = ['{"a":1}', '{"a":2}'],
  ): string {
    const repository = typescriptRepository();

    plantMarker(repository, {
      pid: process.pid,
      pgid: process.pid,
      started_at: new Date().toISOString(),
      ...changes,
    });
    writeProgress(repository, lines);

    return repository;
  }

  it(
    "a_watch_of_a_repository_with_no_marker_emits_a_null_run",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = typescriptRepository();
      const watch = await serve.call("scan.watch", { repository });
      const item = await serve.until(() =>
        serve.lines.find((line) => line.stream === watch.ok && "run" in line),
      );

      expect(item.run).toBeNull();

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "a_watch_of_a_live_run_from_another_process_is_read_with_its_progress_replayed",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = runningRepository();
      const watch = await serve.call("scan.watch", { repository });

      await serve.until(() =>
        serve.lines.filter((line) => line.stream === watch.ok && "line" in line)
          .length === 2
          ? true
          : undefined,
      );

      const items = serve.lines.filter((line) => line.stream === watch.ok);

      expect(items[0]?.run.phase).toBe("running");
      expect(items.slice(1).map((item) => item.line)).toEqual([
        '{"a":1}',
        '{"a":2}',
      ]);

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "a_watch_ends_after_scan_unwatch_and_no_further_item_arrives",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = typescriptRepository();
      const watch = await serve.call("scan.watch", { repository });

      await serve.until(() =>
        serve.lines.find((line) => line.stream === watch.ok && "run" in line),
      );
      await serve.call("scan.unwatch", { watch: watch.ok });

      const before = serve.lines.length;

      plantMarker(repository, { pid: process.pid });
      await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS * 2));

      expect(serve.lines.length).toBe(before);

      await serve.close();
    },
    TIMEOUT,
  );

  it("a_watch_poll_runs_every_quarter_second_while_a_scan_is_active_and_every_second_otherwise", () => {
    const state = newWatchState();

    expect(pollInterval(state)).toBe(IDLE_POLL_MS);

    const repository = runningRepository();

    watchTick(nodeIo(), repository, state);

    expect(pollInterval(state)).toBe(ACTIVE_POLL_MS);
    expect(ACTIVE_POLL_MS).toBe(250);
    expect(IDLE_POLL_MS).toBe(1000);
  });

  it("a_watch_replays_a_new_run_id_from_the_start", () => {
    const repository = runningRepository({ run_id: "run-1" }, ["x", "y"]);
    const state = newWatchState();
    const io = nodeIo();

    expect(
      watchTick(io, repository, state).filter((item) => "line" in item),
    ).toHaveLength(2);
    expect(watchTick(io, repository, state)).toEqual([]);

    plantMarker(repository, {
      pid: process.pid,
      started_at: new Date().toISOString(),
      run_id: "run-2",
    });
    writeProgress(repository, ["z"]);

    expect(
      watchTick(io, repository, state)
        .filter((item) => "line" in item)
        .map((item) => (item as { line: string }).line),
    ).toEqual(["z"]);
  });

  it("a_watch_emits_a_terminal_record_after_the_lines_that_ended_the_run", () => {
    const repository = runningRepository({}, ["x"]);
    const state = newWatchState();
    const io = nodeIo();

    watchTick(io, repository, state);
    plantMarker(repository, {
      pid: process.pid,
      started_at: new Date().toISOString(),
      phase: "finished",
      ended_at: new Date().toISOString(),
      exit: 0,
      commit: "abc1234",
      ran: ["extract"],
    });
    writeProgress(repository, ["x", "y"]);

    const items = watchTick(io, repository, state);

    expect(items.map((item) => ("line" in item ? "line" : "run"))).toEqual([
      "line",
      "run",
    ]);
  });

  it("a_watch_emits_an_active_record_before_its_lines", () => {
    const repository = runningRepository();
    const items = watchTick(nodeIo(), repository, newWatchState());

    expect(items.map((item) => ("line" in item ? "line" : "run"))).toEqual([
      "run",
      "line",
      "line",
    ]);
  });

  it("a_watch_post_exit_tick_emits_the_terminal_record_and_trailing_lines_once", () => {
    const repository = runningRepository({}, ["x"]);
    const state = newWatchState();
    const io = nodeIo();

    watchTick(io, repository, state);
    plantMarker(repository, {
      pid: process.pid,
      started_at: new Date().toISOString(),
      phase: "finished",
      ended_at: new Date().toISOString(),
      exit: 0,
      commit: "abc1234",
      ran: ["extract"],
    });
    writeProgress(repository, ["x", "tail"]);

    expect(watchTick(io, repository, state)).toHaveLength(2);
    expect(watchTick(io, repository, state)).toEqual([]);
  });

  it("a_watch_of_a_finished_run_seen_first_emits_its_record_but_not_its_lines", () => {
    const repository = runningRepository(
      {
        phase: "finished",
        ended_at: new Date().toISOString(),
        exit: 0,
        commit: "abc1234",
        ran: ["extract"],
      },
      ["x", "y"],
    );
    const items = watchTick(nodeIo(), repository, newWatchState());

    expect(items).toHaveLength(1);
    expect("run" in (items[0] as object)).toBe(true);
  });
});

describe("recognizer serve: confirm answers", () => {
  function answerPathOf(repository: string): string {
    return join(cacheOf(repository), "scan-running.answer.json");
  }

  function waitingRepository(runId: string): string {
    const repository = typescriptRepository();

    plantMarker(repository, {
      pid: process.pid,
      pgid: process.pid,
      run_id: runId,
      started_at: new Date().toISOString(),
    });

    return repository;
  }

  it(
    "confirm_answer_writes_one_answer_for_the_live_run",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = waitingRepository("run-1");

      expect(
        (await serve.call("confirm.answer", { repository, describe: true })).ok,
      ).toBe(null);
      expect(
        JSON.parse(readFileSync(answerPathOf(repository), "utf8")),
      ).toEqual({
        version: 1,
        run_id: "run-1",
        describe: true,
      });
      expect(
        (await serve.call("confirm.answer", { repository, describe: false }))
          .error,
      ).toBe("this scan was already answered");

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "confirm_answer_writes_the_answer_for_a_new_run_over_a_stale_one",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = waitingRepository("run-2");

      writeFileSync(
        answerPathOf(repository),
        JSON.stringify({ version: 1, run_id: "run-1", describe: false }),
      );

      expect(
        (await serve.call("confirm.answer", { repository, describe: true })).ok,
      ).toBe(null);
      expect(
        JSON.parse(readFileSync(answerPathOf(repository), "utf8")).run_id,
      ).toBe("run-2");

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "confirm_answer_refuses_without_a_live_running_record",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = typescriptRepository();

      expect(
        (await serve.call("confirm.answer", { repository, describe: true }))
          .error,
      ).toBe("no scan is waiting for an answer");
      expect(existsSync(answerPathOf(repository))).toBe(false);

      await serve.close();
    },
    TIMEOUT,
  );
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

describe("recognizer serve: plans", () => {
  const SENSOR_CONFIG = (names: string[]) =>
    `sensors:\n${names.map((name) => `  ${name}: {}\n`).join("")}`;

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

  function configure(repository: string, names: string[]): void {
    mkdirSync(join(repository, ".recognizer"), { recursive: true });
    writeFileSync(
      join(repository, ".recognizer", "config.yaml"),
      SENSOR_CONFIG(names),
    );
  }

  it(
    "a_plan_through_the_service_drops_unregistered_ticked_names",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = makeTempDir("serve-plan-repo-");

      mkdirSync(cacheOf(repository), { recursive: true });
      cpSync(
        join(REPO, "fixtures/typescript/expected-scan.json"),
        join(cacheOf(repository), "scan.typescript.json"),
      );
      configure(repository, ["crap"]);

      const plan = (
        await serve.call("scan.plan", {
          repository,
          mode: "bring",
          ticks: ticks({ ticked: ["crap", "nonesuch"], armed: ["crap"] }),
          scope: null,
          changed: [],
        })
      ).ok;

      expect(plan.intent.sense).toEqual(["crap"]);
      expect(plan.dropped).toEqual(["nonesuch"]);

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "a_plan_over_the_committed_typescript_scan",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = makeTempDir("serve-plan-repo-");
      const expected = JSON.parse(
        readFileSync(
          join(REPO, "fixtures/typescript/expected-scan.json"),
          "utf8",
        ),
      ) as { modules: unknown[] };
      const shipped = JSON.parse(
        readFileSync(join(REPO, "fixtures/sensors/shipped.json"), "utf8"),
      ) as string[];

      mkdirSync(cacheOf(repository), { recursive: true });
      cpSync(
        join(REPO, "fixtures/typescript/expected-scan.json"),
        join(cacheOf(repository), "scan.typescript.json"),
      );
      configure(repository, shipped);

      expect(expected.modules.length).toBeGreaterThan(0);

      const plan = (
        await serve.call("scan.plan", {
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

      await serve.close();
    },
    TIMEOUT,
  );
});
