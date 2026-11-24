import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { REPO } from "./helpers.js";
import {
  BIN,
  type Line,
  launcher,
  Serve,
  typescriptRepository,
} from "./serve-harness.js";

const TIMEOUT = scaledTimeout(180_000);
const MANIFEST_EXAMPLE = join(
  REPO,
  "schema/manifest-examples/valid/sensor-crap.json",
);

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

function fakeSensor(directory: string, gate: string, name: string): void {
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
      `  echo 'recognizer-event {"event":"start","total":2,"unit":"functions"}' >&2`,
      `  echo 'recognizer-event {"event":"progress","done":1,"total":2,"unit":"functions"}' >&2`,
      `  while [ -e ${gate}/hold-${name} ]; do sleep 0.1; done`,
      `  echo 'recognizer-event {"event":"progress","done":2,"total":2,"unit":"functions"}' >&2`,
      `  mkdir -p "$(dirname "$out")"`,
      `  printf '{"findings_version":1,"sensor":{"name":"${name}","version":"1"},"commit":"%s","modified":false,"settings":{},"findings":[]}' "$commit" > "$out";;`,
      `esac`,
    ].join("\n"),
  );
}

function plugins(gate: string, names: string[]): string {
  const directory = makeTempDir("serve-state-plugins-");

  launcher(
    directory,
    "recognizer-scan-typescript",
    `exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@"`,
  );

  for (const name of names) {
    fakeSensor(directory, gate, name);
  }

  return directory;
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

function states(serve: Serve, stream: string): Line["state"][] {
  return serve.lines
    .filter((line) => line.stream === stream && "state" in line)
    .map((line) => line.state);
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

describe("serve repository state", () => {
  it(
    "repository_watch_streams_revisions_through_a_long_run",
    async () => {
      const gate = makeTempDir("serve-state-gate-");
      const repository = repositoryWith(["crap", "mutation"]);
      const serve = new Serve(plugins(gate, ["crap", "mutation"]));

      writeFileSync(holdFile(gate, "crap"), "");

      try {
        const watch = (await serve.call("repository.watch", { repository })).ok;

        await untilState(serve, watch, (state) => state.revision === 1);
        expect(states(serve, watch)[0].registry.entries).toHaveLength(2);

        const started = await serve.call("scan.start", {
          repository,
          describe: false,
          analysis: false,
          sense: ["crap", "mutation"],
        });

        await untilState(
          serve,
          watch,
          (state) => pluginStates(state, "crap") === "running",
        );

        rmHold(holdFile(gate, "crap"));

        expect((await serve.outcome(started.ok)).status).toBe("finished");

        const last = await untilState(
          serve,
          watch,
          (state) =>
            state.run?.state === "finished" &&
            state.results.mutation.results.length === 1,
        );

        expect(last.results.crap.results).toHaveLength(1);

        const seen = states(serve, watch);

        seen.forEach((state, index) => {
          expect(state.revision).toBe(index + 1);
          expect(
            state.registry.entries.filter((entry: Line) => entry.registered),
          ).toHaveLength(2);
        });

        const order = ["queued", "running", "finished"];

        for (const name of ["crap", "mutation"]) {
          let rank = 0;

          for (const state of seen) {
            const now = pluginStates(state, name) ?? "queued";

            expect(order.indexOf(now)).toBeGreaterThanOrEqual(rank);
            rank = order.indexOf(now);
          }
        }

        expect(
          seen.some(
            (state) =>
              pluginStates(state, "crap") === "running" &&
              pluginStates(state, "mutation") === "queued",
          ),
        ).toBe(true);

        await serve.call("repository.unwatch", { watch });
      } finally {
        rmHold(holdFile(gate, "crap"));
        await serve.close();
      }
    },
    TIMEOUT,
  );

  it(
    "a_catalog_that_cannot_be_read_keeps_the_registered_plugins",
    async () => {
      const gate = makeTempDir("serve-state-gate-");
      const repository = repositoryWith(["crap", "mutation"]);
      const directory = plugins(gate, ["crap", "mutation"]);
      const serve = new Serve(directory);

      try {
        const before = (await serve.call("repository.state", { repository }))
          .ok;

        expect(
          before.registry.entries.map((entry: Line) => entry.name),
        ).toEqual(["crap", "mutation"]);

        chmodSync(directory, 0o000);

        const after = (await serve.call("repository.state", { repository })).ok;

        expect(after.registry.entries.map((entry: Line) => entry.name)).toEqual(
          ["crap", "mutation"],
        );
        expect(Object.keys(after.results)).toEqual(["crap", "mutation"]);
        expect(Object.keys(after.freshness)).toEqual(["crap", "mutation"]);
      } finally {
        chmodSync(directory, 0o755);
        await serve.close();
      }
    },
    TIMEOUT,
  );

  it(
    "a_service_restart_keeps_every_registered_plugin_and_finished_result",
    async () => {
      const gate = makeTempDir("serve-state-gate-");
      const repository = repositoryWith(["crap", "mutation"]);
      const directory = plugins(gate, ["crap", "mutation"]);
      const first = new Serve(directory);
      let before: Line;

      try {
        const started = await first.call("scan.start", {
          repository,
          describe: false,
          analysis: false,
          sense: ["crap", "mutation"],
        });

        expect((await first.outcome(started.ok)).status).toBe("finished");
        before = (await first.call("repository.state", { repository })).ok;
      } finally {
        await first.close();
      }

      const second = new Serve(directory);

      try {
        const after = (await second.call("repository.state", { repository }))
          .ok;
        const { revision: _a, ...fresh } = after;
        const { revision: _b, ...old } = before;

        expect(after.revision).toBe(1);
        expect(fresh).toEqual(old);
        expect(after.results.crap.results).toHaveLength(1);
        expect(after.results.mutation.results).toHaveLength(1);
        expect(after.registry.entries.map((entry: Line) => entry.name)).toEqual(
          ["crap", "mutation"],
        );
      } finally {
        await second.close();
      }
    },
    TIMEOUT,
  );

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

        process.kill(-(child.pid as number), "SIGKILL");

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
    TIMEOUT,
  );

  it(
    "a_config_change_republishes_the_registry",
    async () => {
      const gate = makeTempDir("serve-state-gate-");
      const repository = repositoryWith(["crap", "mutation"]);
      const serve = new Serve(plugins(gate, ["crap", "mutation"]));

      try {
        const watch = (await serve.call("repository.watch", { repository })).ok;

        await untilState(serve, watch, (state) => state.revision === 1);

        const changed = spawnSync(
          process.execPath,
          [BIN, "config", "--remove-section", "sensors.mutation"],
          { cwd: repository, encoding: "utf8" },
        );

        expect(changed.status).toBe(0);

        const after = await untilState(
          serve,
          watch,
          (state) =>
            !state.registry.entries.some(
              (entry: Line) => entry.name === "mutation" && entry.registered,
            ),
        );

        expect(Object.keys(after.results)).toEqual(["crap"]);
        expect(Object.keys(after.freshness)).toEqual(["crap"]);
      } finally {
        await serve.close();
      }
    },
    TIMEOUT,
  );
});

function rmHold(path: string): void {
  spawnSync("rm", ["-f", path]);
}
