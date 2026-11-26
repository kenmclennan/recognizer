import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  event,
  FakeFiles,
  FakeRepositories,
  Gate,
  type Line,
  REPOSITORY,
  type ServeRoot,
  sensorProgram,
  serveRoot,
  typescriptScanner,
  typescriptScenario,
} from "./support/index.js";
import {
  Digest,
  gaugeProgram,
  realText,
  TEST_FILE,
} from "./support/serve-state-programs.js";

const REPO = join(__dirname, "../../..");

const IDLE_MS = 1000;

type State = Line["state"];

function states(root: ServeRoot, stream: string): State[] {
  return root.lines
    .filter((line) => line.stream === stream && "state" in line)
    .map((line) => line.state);
}

function untilState(
  root: ServeRoot,
  stream: string,
  found: (state: State) => boolean,
  ms?: number,
): Promise<State> {
  return root.until(() => states(root, stream).find(found), ms);
}

function pluginStates(state: State, name: string): string | undefined {
  return state.run?.plugins.find((one: Line) => one.name === name)?.state;
}

function freshnessOf(state: State, name: string): string | undefined {
  return state.freshness[name]?.state;
}

async function reportedWithin(
  root: ServeRoot,
  stream: string,
  mark: number,
  found: (state: State) => boolean,
  limit: number,
): Promise<number> {
  await root.advance(0);
  expect(states(root, stream).slice(mark).find(found)).toBeUndefined();

  for (let elapsed = 1; elapsed <= limit; elapsed += 1) {
    await root.advance(1);

    if (states(root, stream).slice(mark).find(found) !== undefined) {
      return elapsed;
    }
  }

  throw new Error(`no report within ${limit} ms`);
}

function start(root: ServeRoot, repository: string, sense: string[]) {
  return root.call("scan.start", {
    repository,
    describe: false,
    analysis: false,
    sense,
  });
}

function startPlanned(
  root: ServeRoot,
  repository: string,
  sense: string[],
  plannedMs?: unknown,
) {
  return root.call("scan.start", {
    repository,
    describe: false,
    analysis: false,
    sense,
    ...(plannedMs === undefined ? {} : { plannedMs }),
  });
}

function configure(root: ServeRoot, repository: string, sensors: string[]) {
  root.io.files.writeFile(
    `${repository}/.recognizer/config.yaml`,
    `sensors:\n${sensors.map((name) => `  ${name}: {}`).join("\n")}\n`,
  );
}

const hasMutation = (state: State) =>
  state.registry.entries.some(
    (entry: Line) => entry.name === "mutation" && entry.registered,
  );

describe("serve repository state", () => {
  it("repository_watch_streams_a_plugins_stage_and_estimate", async () => {
    const gate = new Gate();
    const { root, repository } = typescriptScenario({
      sensors: ["crap"],
      scripts: {
        crap: {
          gate,
          before: [
            event({ event: "start", total: 2, unit: "functions" }),
            event({ event: "stage", name: "one", index: 1, of: 2 }),
            event({ event: "estimate", remaining_ms: 7_200_000 }),
          ],
          after: [
            event({ event: "stage", name: "two", index: 2, of: 2 }),
            event({
              event: "progress",
              done: 1,
              total: 2,
              unit: "functions",
            }),
          ],
        },
      },
    });

    gate.hold();

    const watch = (await root.call("repository.watch", { repository })).ok;

    await untilState(root, watch, (state) => state.revision === 1);

    const started = await start(root, repository, ["crap"]);
    const plugin = (state: State) =>
      state.run?.plugins.find((one: Line) => one.name === "crap");

    await untilState(root, watch, (state) => plugin(state)?.stage?.index === 1);
    gate.open();
    await untilState(root, watch, (state) => plugin(state)?.stage?.index === 2);

    for (const state of states(root, watch)) {
      const seen = plugin(state);

      if (seen?.state === "running" && seen.stage !== null) {
        expect(seen.estimateMs).toBe(7_200_000);
      }
    }

    await root.outcome(started.ok);
    await root.call("repository.unwatch", { watch });
    await root.close();
  });

  it("a_scan_start_carries_its_planned_figures_into_the_snapshot", async () => {
    const gate = new Gate();
    const { root, repository } = typescriptScenario({
      sensors: ["crap"],
      scripts: {
        crap: {
          gate,
          before: [event({ event: "start", total: 2, unit: "functions" })],
          after: [],
        },
      },
    });

    gate.hold();

    const watch = (await root.call("repository.watch", { repository })).ok;

    await untilState(root, watch, (state) => state.revision === 1);

    const started = await startPlanned(root, repository, ["crap"], {
      crap: 5000,
    });
    const silent = await untilState(
      root,
      watch,
      (state) => pluginStates(state, "crap") === "running",
    );
    const crap = (state: State) =>
      state.run?.plugins.find((one: Line) => one.name === "crap");

    expect(crap(silent).estimateMs).toBeNull();
    expect(crap(silent).effectiveEstimate).toEqual({
      ms: 5000,
      source: "history",
    });
    expect(silent.run.remaining).toEqual({ ms: 5000, silent: [] });

    gate.open();
    await root.outcome(started.ok);
    await root.call("repository.unwatch", { watch });
    await root.close();
  });

  it("a_scan_start_with_a_malformed_planned_figure_is_refused", async () => {
    const { root, repository } = typescriptScenario({ sensors: ["crap"] });

    for (const bad of [{ crap: "5" }, { crap: -1 }, [5000], "5"]) {
      const started = await startPlanned(root, repository, ["crap"], bad);
      const outcome = await root.outcome(started.ok);

      expect(outcome.status).toBe("failed");
      expect(outcome.reason).toBe("invalid-request");
      expect(outcome.messages.join("\n")).toContain("plannedMs");
    }

    expect(root.lines.some((line) => line.run?.id !== undefined)).toBe(false);

    await root.close();
  });

  it("a_scan_start_without_planned_figures_is_unchanged", async () => {
    const gate = new Gate();
    const { root, repository } = typescriptScenario({
      sensors: ["crap"],
      scripts: {
        crap: {
          gate,
          before: [event({ event: "start", total: 2, unit: "functions" })],
          after: [],
        },
      },
    });

    gate.hold();

    const watch = (await root.call("repository.watch", { repository })).ok;

    await untilState(root, watch, (state) => state.revision === 1);

    const started = await startPlanned(root, repository, ["crap"]);
    const running = await untilState(
      root,
      watch,
      (state) => pluginStates(state, "crap") === "running",
    );
    const crap = running.run.plugins.find((one: Line) => one.name === "crap");

    expect(crap.effectiveEstimate).toBeNull();
    expect(running.run.remaining).toEqual({ ms: null, silent: ["crap"] });

    gate.open();
    await root.outcome(started.ok);
    await root.call("repository.unwatch", { watch });
    await root.close();
  });

  it("a_failed_sensor_snapshot_carries_its_reason_and_diagnosis", async () => {
    const { root, repository } = typescriptScenario({
      sensors: ["crap"],
      scripts: {
        crap: {
          before: [
            event({ event: "start", total: 2, unit: "functions" }),
            event({
              event: "diagnosis",
              code: "no-coverage",
              text: "no coverage report",
            }),
          ],
          after: [],
          fails: true,
        },
      },
    });
    const watch = (await root.call("repository.watch", { repository })).ok;

    await untilState(root, watch, (state) => state.revision === 1);

    const started = await start(root, repository, ["crap"]);

    await root.outcome(started.ok);

    const failed = await untilState(
      root,
      watch,
      (state) => pluginStates(state, "crap") === "failed",
    );
    const plugin = failed.run.plugins.find((one: Line) => one.name === "crap");

    expect(plugin.failure.reason).not.toBe("");
    expect(plugin.failure.diagnosis.code).toBe("no-coverage");

    for (const state of states(root, watch)) {
      const seen = state.run?.plugins.find((one: Line) => one.name === "crap");

      if (seen?.state === "failed") {
        expect(seen.failure).not.toBeNull();
      }
    }

    await root.call("repository.unwatch", { watch });
    await root.close();
  });

  it("repository_watch_streams_revisions_through_a_long_run", async () => {
    const gate = new Gate();
    const { root, repository } = typescriptScenario({
      sensors: ["crap", "mutation"],
      scripts: { crap: { gate } },
    });

    gate.hold();

    const watch = (await root.call("repository.watch", { repository })).ok;

    await untilState(root, watch, (state) => state.revision === 1);
    expect(states(root, watch)[0].registry.entries).toHaveLength(2);

    const started = await start(root, repository, ["crap", "mutation"]);

    await untilState(
      root,
      watch,
      (state) => pluginStates(state, "crap") === "running",
    );
    gate.open();

    expect((await root.outcome(started.ok)).status).toBe("finished");

    const last = await untilState(
      root,
      watch,
      (state) =>
        state.run?.state === "finished" &&
        state.results.mutation.results.length === 1,
    );

    expect(last.results.crap.results).toHaveLength(1);

    const seen = states(root, watch);

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

    await root.call("repository.unwatch", { watch });
    await root.close();
  });

  it("a_catalog_that_cannot_be_read_keeps_the_registered_plugins", async () => {
    const { root, repository } = typescriptScenario({
      sensors: ["crap", "mutation"],
    });
    const before = (await root.call("repository.state", { repository })).ok;

    expect(before.registry.entries.map((entry: Line) => entry.name)).toEqual([
      "crap",
      "mutation",
    ]);

    const readDir = root.io.readDir;

    root.io.readDir = (path) => {
      if (path === "/fake-bin") {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }

      return readDir(path);
    };

    const after = (await root.call("repository.state", { repository })).ok;

    expect(after.registry.entries.map((entry: Line) => entry.name)).toEqual([
      "crap",
      "mutation",
    ]);
    expect(Object.keys(after.results)).toEqual(["crap", "mutation"]);
    expect(Object.keys(after.freshness)).toEqual(["crap", "mutation"]);
    await root.close();
  });

  it("a_service_restart_keeps_every_registered_plugin_and_finished_result", async () => {
    const programs = {
      "recognizer-sense-crap": sensorProgram("crap"),
      "recognizer-sense-mutation": sensorProgram("mutation"),
    };
    const files = new FakeFiles();
    const repositories = new FakeRepositories(files);
    const first = typescriptScenario({
      sensors: ["crap", "mutation"],
      files,
      repositories,
    });

    const started = await start(first.root, first.repository, [
      "crap",
      "mutation",
    ]);

    expect((await first.root.outcome(started.ok)).status).toBe("finished");
    const before = (
      await first.root.call("repository.state", { repository: REPOSITORY })
    ).ok;
    await first.root.close();

    const second = serveRoot({
      files,
      repositories,
      programs: {
        ...programs,
        "recognizer-scan-typescript": typescriptScanner(),
      },
    });
    const after = (
      await second.call("repository.state", { repository: REPOSITORY })
    ).ok;
    const { revision: _a, ...fresh } = after;
    const { revision: _b, ...old } = before;

    expect(after.revision).toBe(1);
    expect(fresh).toEqual(old);
    expect(after.results.crap.results).toHaveLength(1);
    expect(after.results.mutation.results).toHaveLength(1);
    expect(after.registry.entries.map((entry: Line) => entry.name)).toEqual([
      "crap",
      "mutation",
    ]);
    await second.close();
  });

  it("a_config_change_republishes_the_registry", async () => {
    const { root, repository } = typescriptScenario({
      sensors: ["crap", "mutation"],
    });
    const watch = (await root.call("repository.watch", { repository })).ok;

    await untilState(root, watch, (state) => state.revision === 1);
    configure(root, repository, ["crap"]);

    const after = await untilState(root, watch, (state) => !hasMutation(state));

    expect(Object.keys(after.results)).toEqual(["crap"]);
    expect(Object.keys(after.freshness)).toEqual(["crap"]);
    await root.close();
  });

  it("an_uncommitted_test_edit_turns_the_result_stale_within_10_s_first_edit_and_after_a_run", async () => {
    const digest = new Digest();
    const { root, repository } = typescriptScenario({
      registered: ["gauge"],
      programs: { "recognizer-sense-gauge": gaugeProgram(digest) },
    });
    const recordDigest = async () => {
      digest.value = (await root.call("tests.hash", { repository, known: {} }))
        .ok as string;
    };
    const editTest = (marker: string) => {
      const file = `${repository}/${TEST_FILE}`;

      root.io.files.writeFile(
        file,
        `${root.io.files.readFile(file)}\n// ${marker}\n`,
      );
    };

    await recordDigest();

    const first = await start(root, repository, ["gauge"]);

    expect((await root.outcome(first.ok)).status).toBe("finished");

    const watch = (await root.call("repository.watch", { repository })).ok;

    await untilState(
      root,
      watch,
      (state) => freshnessOf(state, "gauge") === "current",
    );

    editTest("first");
    expect(
      await reportedWithin(
        root,
        watch,
        states(root, watch).length,
        (state) => freshnessOf(state, "gauge") === "stale",
        IDLE_MS,
      ),
    ).toBeLessThanOrEqual(IDLE_MS);

    await recordDigest();

    const second = await start(root, repository, ["gauge"]);

    expect((await root.outcome(second.ok)).status).toBe("finished");

    const mark = states(root, watch).length;

    await root.until(
      () =>
        states(root, watch)
          .slice(mark)
          .find((state) => freshnessOf(state, "gauge") === "current"),
      10_000,
    );

    editTest("second");
    expect(
      await reportedWithin(
        root,
        watch,
        states(root, watch).length,
        (state) => freshnessOf(state, "gauge") === "stale",
        IDLE_MS,
      ),
    ).toBeLessThanOrEqual(IDLE_MS);
    await root.close();
  });

  it("a_registration_change_reaches_the_snapshot_within_10_s", async () => {
    const { root, repository } = typescriptScenario({
      sensors: ["crap", "mutation"],
    });
    const watch = (await root.call("repository.watch", { repository })).ok;
    const first = await untilState(
      root,
      watch,
      (state) => state.revision === 1,
    );

    expect(hasMutation(first)).toBe(true);
    configure(root, repository, ["crap"]);

    expect(
      await reportedWithin(
        root,
        watch,
        states(root, watch).length,
        (state) => !hasMutation(state),
        IDLE_MS,
      ),
    ).toBeLessThanOrEqual(IDLE_MS);

    const before = states(root, watch).at(-1) as State;
    const policy = `${repository}/.recognizer/policy.yaml`;

    root.io.files.writeFile(
      policy,
      `${root.io.files.exists(policy) ? root.io.files.readFile(policy) : ""}\n`,
    );
    expect(
      await reportedWithin(
        root,
        watch,
        states(root, watch).length,
        (state) => state.inputsDigest !== before.inputsDigest,
        IDLE_MS,
      ),
    ).toBeLessThanOrEqual(IDLE_MS);
    await root.close();
  });

  it("results_read_returns_findings_and_overlay_texts_and_the_revision", async () => {
    const { root, repository } = typescriptScenario({ sensors: ["crap"] });
    const started = await start(root, repository, ["crap"]);

    expect((await root.outcome(started.ok)).status).toBe("finished");
    root.io.files.writeFile(
      `${repository}/.recognizer/cache/overlays/crap.json`,
      realText(join(REPO, "schema", "overlay-examples", "valid", "crap.json")),
    );

    const state = (await root.call("repository.state", { repository })).ok;
    const read = (await root.call("results.read", { repository })).ok;

    expect(read.revision).toBe(state.revision);
    expect(read.plugins.crap.findings.sensor.name).toBe("crap");
    expect(read.plugins.crap.overlay.producer.name).toBe("crap");
    expect(read.plugins.crap.findingsProblem).toBeNull();
    expect(read.plugins.crap.overlayProblem).toBeNull();
    await root.close();
  });

  it("results_read_flags_an_unreadable_file_and_deletes_nothing", async () => {
    const { root, repository } = typescriptScenario({ sensors: ["crap"] });
    const file = `${repository}/.recognizer/cache/findings/crap.json`;

    root.io.files.writeFile(file, "not json");

    const read = (await root.call("results.read", { repository })).ok;

    expect(read.plugins.crap.findings).toBeNull();
    expect(read.plugins.crap.findingsProblem).not.toBeNull();
    expect(root.io.files.readFile(file)).toBe("not json");
    await root.close();
  });

  it("results_read_names_the_invalid_file_and_returns_the_valid_one_unchanged", async () => {
    const { root, repository } = typescriptScenario({
      sensors: ["crap", "mutation"],
    });
    const cache = `${repository}/.recognizer/cache`;
    const started = await start(root, repository, ["crap", "mutation"]);

    expect((await root.outcome(started.ok)).status).toBe("finished");

    const valid = JSON.parse(
      root.io.files.readFile(`${cache}/findings/crap.json`),
    );

    root.io.files.writeFile(`${cache}/findings/mutation.json`, "not json");
    root.io.files.writeFile(`${cache}/overlays/mutation.json`, '{"overlay":1}');

    const read = (await root.call("results.read", { repository })).ok;

    expect(read.plugins.crap.findingsProblem).toBeNull();
    expect(read.plugins.crap.findings.commit).toBe(valid.commit);
    expect(read.plugins.mutation.findings).toBeNull();
    expect(read.plugins.mutation.findingsProblem).not.toBeNull();
    expect(read.plugins.mutation.overlay).toBeNull();
    expect(read.plugins.mutation.overlayProblem).not.toBeNull();
    expect(read.refusals).toEqual({});
    await root.close();
  });

  it("results_read_carries_each_documents_freshness_and_the_last_run", async () => {
    const { root, repository } = typescriptScenario({ sensors: ["crap"] });
    const started = await start(root, repository, ["crap"]);

    expect((await root.outcome(started.ok)).status).toBe("finished");

    const read = (
      await root.call("results.read", { repository, tests: "digest" })
    ).ok;
    const { freshness } = read.plugins.crap;

    expect(typeof freshness.valid).toBe("boolean");
    expect(Array.isArray(freshness.current)).toBe(true);
    expect(typeof freshness.outOfDate).toBe("number");
    expect(read.lastRun).toMatch(/^\d{8}T\d{9}Z-scan\.json$/);
    await root.close();
  });

  it("inputs_read_returns_the_config_policy_and_baseline_parsed_with_their_problems", async () => {
    const { root, repository } = typescriptScenario({ sensors: ["crap"] });
    const folder = `${repository}/.recognizer`;

    root.io.files.writeFile(`${folder}/policy.yaml`, "components: nonsense: [");
    root.io.files.writeFile(`${folder}/baselines/violations.json`, "not json");

    const bad = (await root.call("inputs.read", { repository })).ok;

    expect(bad.config).toEqual(expect.anything());
    expect(bad.configText).toEqual(expect.any(String));
    expect(bad.policy).toBeNull();
    expect(bad.policyProblem).toEqual(expect.any(String));
    expect(bad.baseline).toBeNull();
    expect(bad.baselineProblem).toEqual(expect.any(String));
    expect(bad.refused).toEqual([]);

    root.io.files.writeFile(
      `${folder}/baselines/violations.json`,
      JSON.stringify({ schema_version: 1, violations: [] }),
    );

    const good = (await root.call("inputs.read", { repository })).ok;

    expect(good.baseline).toEqual([]);
    expect(good.baselineProblem).toBeNull();
    await root.close();
  });

  it("scan_estimate_names_every_part_with_no_figure_when_the_run_log_is_empty", async () => {
    const { root, repository } = typescriptScenario({ sensors: ["crap"] });
    const answer = (
      await root.call("scan.estimate", {
        repository,
        intent: { describe: false, analysis: true, sense: [] },
        planWork: {},
        parts: [
          {
            key: "structure",
            name: "Structure",
            runsTests: false,
            scoped: false,
            workVerb: null,
          },
        ],
        work: {},
      })
    ).ok;

    expect(answer.parts).toEqual([
      { key: "structure", name: "Structure", ms: null, basis: null },
    ]);
    expect(answer.lastRun).toBeNull();
    await root.close();
  });

  it("scan_ticks_applies_the_changes_in_order_and_refuses_a_malformed_request", async () => {
    const { root } = typescriptScenario({ sensors: ["crap"] });
    const ticks = {
      describe: false,
      analysis: true,
      ticked: null,
      armed: [],
      onlyView: false,
      suites: {},
      folds: [],
    };
    const answer = (
      await root.call("scan.ticks", {
        ticks,
        changes: [
          { kind: "describe", ticked: true },
          { kind: "fold", sensor: "crap" },
          { kind: "fold", sensor: "mutation" },
          { kind: "fold", sensor: "crap" },
        ],
      })
    ).ok;

    expect(answer).toEqual({ ...ticks, describe: true, folds: ["mutation"] });
    expect(
      (await root.call("scan.ticks", { ticks, changes: [{ kind: "x" }] })).ok,
    ).toBeUndefined();
    await root.close();
  });

  it("results_clear_removes_one_plugins_files_only", async () => {
    const { root, repository } = typescriptScenario({
      sensors: ["crap", "mutation"],
    });
    const started = await start(root, repository, ["crap", "mutation"]);

    expect((await root.outcome(started.ok)).status).toBe("finished");

    const cache = `${repository}/.recognizer/cache`;
    const files = root.io.files;

    files.writeFile(`${cache}/overlays/crap.json`, "{}");
    files.writeFile(`${cache}/overlays/mutation.json`, "{}");

    expect(
      (await root.call("results.clear", { repository, plugin: "crap" })).ok,
    ).toBeNull();
    expect(files.exists(`${cache}/findings/crap.json`)).toBe(false);
    expect(files.exists(`${cache}/overlays/crap.json`)).toBe(false);
    expect(files.exists(`${cache}/findings/mutation.json`)).toBe(true);
    expect(files.exists(`${cache}/overlays/mutation.json`)).toBe(true);
    expect(
      (await root.call("results.clear", { repository, plugin: "../x" })).error,
    ).toBeDefined();
    await root.close();
  });

  it("inputs_digest_over_this_repositorys_committed_policy_and_config", async () => {
    const { root, repository } = typescriptScenario({ sensors: ["crap"] });
    const recognizer = `${repository}/.recognizer`;
    const policy = `${recognizer}/policy.yaml`;
    const committedPolicy = realText(join(REPO, ".recognizer", "policy.yaml"));
    const committedConfig = realText(join(REPO, ".recognizer", "config.yaml"));

    expect(committedPolicy.length).toBeGreaterThan(0);
    expect(committedConfig.length).toBeGreaterThan(0);

    root.io.files.writeFile(policy, committedPolicy);
    root.io.files.writeFile(`${recognizer}/config.yaml`, committedConfig);

    const first = (await root.call("repository.state", { repository })).ok;

    root.io.files.writeFile(policy, `${committedPolicy}#`);

    const changed = (await root.call("repository.state", { repository })).ok;

    root.io.files.writeFile(policy, committedPolicy);

    const restored = (await root.call("repository.state", { repository })).ok;

    expect(changed.inputsDigest).not.toBe(first.inputsDigest);
    expect(restored.inputsDigest).toBe(first.inputsDigest);
    await root.close();
  });
});

describe("serve repository watch poll", () => {
  it("the_repository_watch_polls_every_second_when_idle_and_every_quarter_second_during_a_scan", async () => {
    const gate = new Gate();
    const root = serveRoot({
      programs: { "recognizer-sense-crap": sensorProgram("crap", { gate }) },
    });
    const repository = "/repo";
    const config = `${repository}/.recognizer/config.yaml`;

    root.io.files.writeFile(`${repository}/a.ts`, "one");
    root.io.files.writeFile(`${repository}/.gitignore`, ".recognizer/cache/\n");
    root.io.files.writeFile(config, "sensors:\n  crap: {}\n");
    root.repositories.commitAll(repository);
    gate.hold();

    const watch = (await root.call("repository.watch", { repository })).ok;
    const reports = () =>
      root.lines.filter((line) => line.stream === watch && "state" in line)
        .length;

    await root.advance(0);

    const first = reports();

    expect(first).toBe(1);

    root.io.files.writeFile(config, "sensors:\n  crap: {}\n  gauge: {}\n");
    await root.advance(999);

    expect(reports()).toBe(first);

    await root.advance(1);

    expect(reports()).toBe(first + 1);

    const started = await root.call("scan.start", {
      repository,
      describe: false,
      analysis: false,
      sense: ["crap"],
    });

    await root.until(() =>
      root.lines.find(
        (line) => line.stream === watch && line.state?.run?.state === "running",
      ),
    );

    const settled = async (count: number) => {
      for (let step = 0; step < 300 && reports() === count; step += 1) {
        await root.advance(1);
      }
    };
    const beforeEdit = reports();

    root.io.files.writeFile(config, "sensors:\n  crap: {}\n");
    await settled(beforeEdit);

    const aligned = reports();

    expect(aligned).toBe(beforeEdit + 1);

    root.io.files.writeFile(config, "sensors:\n  crap: {}\n  other: {}\n");
    await root.advance(249);

    expect(reports()).toBe(aligned);

    await root.advance(1);

    expect(reports()).toBe(aligned + 1);

    gate.open();
    await root.outcome(started.ok);
    await root.close();
  });
});
