import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { REPO } from "./helpers.js";
import {
  type Line,
  launcher,
  Serve,
  typescriptRepository,
} from "./serve-harness.js";

const TIMEOUT = scaledTimeout(240_000);
const MANIFEST_EXAMPLE = join(
  REPO,
  "schema/manifest-examples/valid/sensor-crap.json",
);
const SENSORS = ["alpha", "beta", "gamma"];
const ORDER = ["queued", "running", "finished"];

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
      `  commit=""; out=""; root=""`,
      `  while [ $# -gt 0 ]; do`,
      `    case "$1" in --commit) commit="$2";; --output) out="$2";; --repository) root="$2";; esac`,
      `    shift`,
      `  done`,
      `  echo 'recognizer-event {"event":"start","total":2,"unit":"functions"}' >&2`,
      `  while [ -e ${gate}/hold-${name} ]; do sleep 0.1; done`,
      `  mkdir -p "$root/.recognizer/cache/overlays"`,
      `  printf '{"overlay_version":1,"inputs":{},"commit":"%s","modified":false,"producer":{"name":"${name}","version":"1"},"metrics":[],"values":{}}' "$commit" > "$root/.recognizer/cache/overlays/${name}.json"`,
      `  mkdir -p "$(dirname "$out")"`,
      `  printf '{"findings_version":1,"sensor":{"name":"${name}","version":"1"},"commit":"%s","modified":false,"settings":{},"findings":[]}' "$commit" > "$out";;`,
      `esac`,
    ].join("\n"),
  );
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

function states(serve: Serve, stream: string): Line["state"][] {
  return serve.lines
    .filter((line) => line.stream === stream && "state" in line)
    .map((line) => line.state);
}

function stateOf(state: Line["state"], name: string): string | undefined {
  return state.run?.plugins.find((one: Line) => one.name === name)?.state;
}

function registered(state: Line["state"]): string[] {
  return state.registry.entries
    .filter((entry: Line) => entry.registered)
    .map((entry: Line) => entry.name);
}

describe("serve soak", () => {
  it(
    "every_sensor_runs_to_completion_and_every_row_and_overlay_survives_each_stage",
    async () => {
      const gate = makeTempDir("serve-soak-gate-");
      const directory = makeTempDir("serve-soak-plugins-");
      const repository = typescriptRepository();

      launcher(
        directory,
        "recognizer-scan-typescript",
        `exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@"`,
      );

      for (const name of SENSORS) {
        fakeSensor(directory, gate, name);
      }

      mkdirSync(join(repository, ".recognizer"), { recursive: true });
      writeFileSync(
        join(repository, ".recognizer", "config.yaml"),
        `sensors:\n${SENSORS.map((name) => `  ${name}: {}`).join("\n")}\n`,
      );
      writeFileSync(
        join(repository, ".gitignore"),
        ".recognizer/cache/\nnode_modules/\n",
      );
      git(repository, "init", "-q");
      git(repository, "add", ".");
      git(repository, "commit", "-q", "-m", "initial");
      writeFileSync(join(gate, "hold-beta"), "");

      const serve = new Serve(directory);

      try {
        const watch = (await serve.call("repository.watch", { repository })).ok;

        await serve.until(() =>
          states(serve, watch).find((state) => state.revision === 1),
        );

        const started = await serve.call("scan.start", {
          repository,
          describe: false,
          analysis: false,
          sense: SENSORS,
        });

        const mixed = await serve.until(() =>
          states(serve, watch).find(
            (state) =>
              (state.run?.plugins ?? []).some(
                (one: Line) =>
                  one.phase === "sense" && one.state === "finished",
              ) &&
              (state.run?.plugins ?? []).some(
                (one: Line) => one.phase === "sense" && one.state === "running",
              ),
          ),
        );

        expect(mixed).toBeDefined();

        const finishedName = mixed.run.plugins.find(
          (one: Line) => one.phase === "sense" && one.state === "finished",
        ).name as string;
        const midRead = (await serve.call("results.read", { repository })).ok;

        expect(midRead.plugins[finishedName].findings).not.toBeNull();
        expect(midRead.plugins[finishedName].overlay.producer.name).toBe(
          finishedName,
        );

        await serve.call("repository.unwatch", { watch });

        const again = (await serve.call("repository.watch", { repository })).ok;
        const replaced = await serve.until(() => states(serve, again)[0]);

        expect(registered(replaced)).toEqual(SENSORS);
        expect(replaced.results[finishedName].results).toHaveLength(1);
        expect(replaced.results[finishedName].results[0].overlay).toBe(
          `overlay:${finishedName}`,
        );

        spawnSync("rm", ["-f", join(gate, "hold-beta")]);

        expect((await serve.outcome(started.ok)).status).toBe("finished");

        await serve.until(() =>
          states(serve, again).find((state) => state.run?.state === "finished"),
        );

        const seen = [...states(serve, watch), ...states(serve, again)];

        for (const state of seen) {
          expect(registered(state)).toEqual(SENSORS);
        }

        for (const name of SENSORS) {
          let rank = 0;

          for (const state of states(serve, again)) {
            const now = ORDER.indexOf(stateOf(state, name) ?? "queued");

            expect(now).toBeGreaterThanOrEqual(rank);
            rank = now;
          }
        }

        const last = (await serve.call("results.read", { repository })).ok;

        for (const name of SENSORS) {
          expect(last.plugins[name].findings).not.toBeNull();
          expect(last.plugins[name].overlay.producer.name).toBe(name);
        }

        expect(
          existsSync(join(repository, ".recognizer", "cache", "findings")),
        ).toBe(true);
      } finally {
        spawnSync("rm", ["-f", join(gate, "hold-beta")]);
        await serve.close();
      }
    },
    TIMEOUT,
  );
});
