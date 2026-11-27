import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { REPO } from "../helpers.js";
import { isolatedPath } from "../isolated-path.js";
import {
  alive,
  BIN,
  hold,
  type Line,
  launcher,
  pidFile,
  plantMarker,
  Serve,
  sharedGates,
  sharedLaunchers,
  sharedServe,
  slowLaunchers,
  typescriptRepository,
} from "../serve-harness.js";
import { signalGroup } from "../signal-group.js";

const TIMEOUT = scaledTimeout(60_000);

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

function sleeper(script: string, detached: boolean) {
  return spawn("/bin/sh", ["-c", script], {
    detached,
    stdio: "ignore",
  });
}

const STATE_TIMEOUT = scaledTimeout(180_000);

function plugins(
  gate: string,
  names: string[],
  scripts: Record<string, Script> = {},
): string {
  const directory = makeTempDir("serve-state-plugins-");

  launcher(
    directory,
    "recognizer-scan-typescript",
    `exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@"`,
  );

  for (const name of names) {
    fakeSensor(directory, gate, name, scripts[name]);
  }

  return directory;
}

function repositoryWith(sensors: string[]): string {
  const repository = typescriptRepository();
  const config = join(repository, ".recognizer", "config.yaml");

  mkdirSync(join(repository, ".recognizer"), { recursive: true });
  writeFileSync(
    config,
    `sensors:\n${sensors.map((name) => `  ${name}: {}`).join("\n")}\n`,
  );
  writeFileSync(
    join(repository, ".gitignore"),
    ".recognizer/cache/\nnode_modules/\n",
  );
  git(repository, "init", "-q");
  git(repository, "add", ".");
  git(repository, "commit", "-q", "-m", "initial");

  return repository;
}

async function untilState(
  serve: Serve,
  stream: string,
  found: (state: Line["state"]) => boolean,
): Promise<Line["state"]> {
  return serve.until(() => states(serve, stream).find(found));
}

function pluginStates(state: Line["state"], name: string): string | undefined {
  return state.run?.plugins.find((one: Line) => one.name === name)?.state;
}

function runningScan(
  repository: string,
  path: string,
  sense: string,
): ChildProcess {
  return spawn(process.execPath, [BIN, "scan", repository, "--sense", sense], {
    env: { ...process.env, PATH: `${path}:${process.env.PATH}` },
    stdio: "ignore",
    detached: true,
  });
}

function holdFile(gate: string, name: string): string {
  return join(gate, `hold-${name}`);
}

function rmHold(path: string): void {
  spawnSync("rm", ["-f", path]);
}

function states(serve: Serve, stream: string): Line["state"][] {
  return serve.lines
    .filter((line) => line.stream === stream && "state" in line)
    .map((line) => line.state);
}

function git(repository: string, ...args: string[]): void {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: repository, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }
}

function fakeSensor(
  directory: string,
  gate: string,
  name: string,
  script?: Script,
): void {
  const manifest = join(gate, `${name}.manifest.json`);

  writeFileSync(manifest, manifestOf(name));
  launcher(
    directory,
    `recognizer-sense-${name}`,
    [
      `case "$1" in`,
      `manifest) cat ${manifest};;`,
      `check) echo '{"gaps":[]}';;`,
      `run)`,
      `  shift`,
      `  commit=""; out=""`,
      `  while [ $# -gt 0 ]; do`,
      `    case "$1" in --commit) commit="$2";; --output) out="$2";; esac`,
      `    shift`,
      `  done`,
      `  echo $$ > ${gate}/${name}.pid`,
      ...(script?.before ?? [
        emit({ event: "start", total: 2, unit: "functions" }),
        emit({ event: "progress", done: 1, total: 2, unit: "functions" }),
      ]),
      `  while [ -e ${gate}/hold-${name} ]; do sleep 0.1; done`,
      ...(script?.after ?? [
        emit({ event: "progress", done: 2, total: 2, unit: "functions" }),
      ]),
      ...(script?.fails ? [`  exit 1`] : []),
      `  mkdir -p "$(dirname "$out")"`,
      `  printf '{"findings_version":1,"sensor":{"name":"${name}","version":"1"},"commit":"%s","modified":false,"settings":{},"findings":[]}' "$commit" > "$out";;`,
      `esac`,
    ].join("\n"),
  );
}

function manifestOf(name: string): string {
  const base = JSON.parse(readFileSync(MANIFEST_EXAMPLE, "utf8"));

  delete base.suite_keys;
  delete base.placeholders;
  delete base.log_path;

  return JSON.stringify({
    ...base,
    name,
    display: name.toUpperCase(),
    runs_tests: false,
    install: `brew install ${name}`,
    settings: [],
  });
}

const emit = (event: object) =>
  `  echo 'recognizer-event ${JSON.stringify(event)}' >&2`;

const MANIFEST_EXAMPLE = join(
  REPO,
  "schema/manifest-examples/valid/sensor-crap.json",
);

describe("serve repository state", () => {
  it(
    "a_killed_scan_ends_stopped_with_a_log_entry_and_a_settled_marker",
    async () => {
      const gate = makeTempDir("serve-state-gate-");
      const repository = repositoryWith(["crap"]);
      const directory = plugins(gate, ["crap"]);
      const serve = new Serve(directory);
      const marker = join(
        repository,
        ".recognizer",
        "cache",
        "scan-running.json",
      );

      writeFileSync(holdFile(gate, "crap"), "");

      const child = runningScan(repository, directory, "crap");

      try {
        await serve.until(() => {
          try {
            return JSON.parse(readFileSync(marker, "utf8")).phase ===
              "running" && existsSync(join(gate, "crap.pid"))
              ? true
              : undefined;
          } catch {
            return undefined;
          }
        });

        signalGroup(child, "SIGKILL");

        const watch = (await serve.call("repository.watch", { repository })).ok;
        const stopped = await untilState(
          serve,
          watch,
          (state) => state.run?.state === "stopped",
        );

        expect(pluginStates(stopped, "crap")).toBe("stopped");

        await serve.until(() => {
          const phase = JSON.parse(readFileSync(marker, "utf8")).phase;

          return phase === "stopped" ? true : undefined;
        });

        const logs = join(repository, ".recognizer", "cache", "log");
        const records = readdirSync(logs)
          .filter((name) => name.endsWith("-scan.json"))
          .map((name) => JSON.parse(readFileSync(join(logs, name), "utf8")));

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ outcome: "stopped", exit: 1 });
        expect(records[0].finished).not.toBeNull();
        expect(
          records[0].phases
            .flatMap((phase: Line) => phase.entries)
            .find((entry: Line) => entry.name === "crap"),
        ).toMatchObject({
          outcome: "stopped",
          reason: "the run was killed outright",
        });
      } finally {
        rmHold(holdFile(gate, "crap"));
        await serve.close();
      }
    },
    STATE_TIMEOUT,
  );
});

describe("recognizer serve: starting a scan", () => {
  it(
    "a_scan_through_the_service_equals_the_cli_scan",
    async () => {
      const launchers = sharedLaunchers();
      const viaService = typescriptRepository();
      const viaCli = typescriptRepository();
      const environment = { ...process.env };

      delete environment.RECOGNIZER_STARTED_BY;

      const cli = spawnSync(process.execPath, [BIN, "scan", viaCli, "--json"], {
        env: { ...environment, PATH: isolatedPath(launchers) },
        encoding: "utf8",
      });

      expect(cli.status).toBe(0);

      const serve = await sharedServe();
      const started = await serve.call("scan.start", {
        repository: viaService,
        describe: false,
        analysis: true,
        sense: [],
      });

      expect(await serve.outcome(started.ok)).toEqual({ status: "finished" });

      const marker = join(cacheOf(viaService), "scan-running.json");

      await serve.until(() => {
        try {
          return JSON.parse(readFileSync(marker, "utf8")).phase === "finished"
            ? true
            : undefined;
        } catch {
          return undefined;
        }
      });

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
});

describe("recognizer serve: stopping", () => {
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
});

describe("recognizer serve: an idle service", () => {
  it(
    "an_idle_service_reads_scanner_manifests_once_and_exits_promptly_on_sigterm",
    async () => {
      const gate = makeTempDir("serve-idle-gate-");
      const calls = join(gate, "manifest-calls");
      const directory = makeTempDir("serve-idle-launchers-");
      const repository = typescriptRepository();

      launcher(
        directory,
        "recognizer-scan-typescript",
        [
          `if [ "$1" = manifest ]; then echo x >> ${calls}; sleep 0.5; fi`,
          `exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@"`,
        ].join("\n"),
      );
      writeFileSync(join(repository, ".gitignore"), ".recognizer/cache/\n");
      git(repository, "init", "-q");
      git(repository, "add", ".");
      git(repository, "commit", "-q", "-m", "initial");

      const serve = new Serve(directory);
      const watch = (await serve.call("repository.watch", { repository })).ok;
      const manifestCalls = () =>
        existsSync(calls)
          ? readFileSync(calls, "utf8").split("\n").filter(Boolean).length
          : 0;

      await untilState(serve, watch, () => true);

      const afterFirstRead = manifestCalls();

      expect(afterFirstRead).toBeGreaterThan(0);

      for (const edit of ["one", "two"]) {
        writeFileSync(
          join(repository, "edited.ts"),
          `export const x = "${edit}";\n`,
        );

        await new Promise((resolve) => setTimeout(resolve, 3_500));
      }

      expect(manifestCalls()).toBe(afterFirstRead);

      const sent = Date.now();

      serve.child.kill("SIGTERM");
      await serve.exited;

      expect(Date.now() - sent).toBeLessThan(scaledTimeout(2_000));
    },
    TIMEOUT,
  );
});

describe("recognizer serve: stop by repository", () => {
  it(
    "stop_by_repository_stops_a_scan_the_service_holds",
    async () => {
      const serve = await sharedServe();
      const repository = typescriptRepository();

      hold(repository);

      const started = await serve.call("scan.start", {
        repository,
        describe: false,
        analysis: false,
        sense: [],
      });

      await pidFile(serve, sharedGates(), repository);
      await serve.call("scan.stop", { repository, owner: "any" });

      expect((await serve.outcome(started.ok)).status).toBe("stopped");
    },
    TIMEOUT,
  );

  it(
    "stop_by_repository_signals_the_group_of_an_app_marker_from_another_process",
    async () => {
      const serve = await sharedServe();
      const repository = typescriptRepository();
      const child = sleeper("sleep 60 & wait", true);
      const pid = child.pid as number;

      plantMarker(repository, { pid, pgid: 999_999, started_by: "app" });
      await serve.call("scan.stop", { repository, owner: "any" });
      await serve.until(() => (alive(pid) ? undefined : true));
      child.kill("SIGKILL");
    },
    TIMEOUT,
  );

  it(
    "stop_by_repository_signals_only_the_pid_of_a_cli_marker",
    async () => {
      const serve = await sharedServe();
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
    },
    TIMEOUT,
  );

  it(
    "stop_by_repository_never_signals_a_marker_naming_the_service",
    async () => {
      const serve = await sharedServe();
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
    },
    TIMEOUT,
  );

  it(
    "stop_by_repository_with_owner_app_skips_a_cli_marker",
    async () => {
      const serve = await sharedServe();
      const repository = typescriptRepository();
      const child = sleeper("sleep 60", true);
      const pid = child.pid as number;

      plantMarker(repository, { pid, pgid: pid, started_by: "cli" });
      await serve.call("scan.stop", { repository, owner: "app" });

      expect(alive(pid)).toBe(true);

      child.kill("SIGKILL");
    },
    TIMEOUT,
  );
});
