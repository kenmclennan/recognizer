import { describe, expect, it } from "vitest";
import type { RepositoryState, RunReport } from "../../src/index.js";
import {
  fakesWith,
  findingsOf,
  holderOver,
  ROOT,
  reportedResult,
  structureOf,
} from "./support.js";

const SENSORS = ["tally", "margin", "ledger"];

function started(name: string): RunReport {
  return { kind: "plugin-started", name, progress: null };
}

function ended(name: string): RunReport {
  return { kind: "plugin-ended", name, state: "finished" };
}

function withoutRevision(
  state: RepositoryState,
): Omit<RepositoryState, "revision"> {
  const { revision: _revision, ...rest } = state;

  return rest;
}

describe("repository state holder", () => {
  it("a long run with a plugin finishing mid-run keeps every registered plugin and every finished result", () => {
    const fakes = fakesWith(...SENSORS);
    const holder = holderOver(fakes);
    const seen: RepositoryState[] = [];

    holder.subscribe((state) => seen.push(state));
    fakes.active.start({ sensors: SENSORS, phase: "running" });
    holder.refresh();
    fakes.active.report(started("tally"));
    holder.refresh();
    fakes.findings.save(ROOT, findingsOf("tally", { "a.py": "h1" }));
    fakes.active.report(ended("tally"), started("margin"));
    holder.refresh();
    fakes.active.report({
      kind: "plugin-progress",
      name: "margin",
      progress: { done: 2, total: 4, unit: "files" },
    });
    holder.refresh();

    const last = holder.current();

    expect(last.run?.plugins.map(({ state }) => state)).toEqual([
      "finished",
      "running",
      "queued",
    ]);

    let finishedAt = -1;

    seen.forEach((state, index) => {
      expect(state.registry.entries.map(({ name }) => name)).toEqual(SENSORS);

      if (state.results.tally?.results.length === 1 && finishedAt === -1) {
        finishedAt = index;
      }

      if (finishedAt !== -1 && index >= finishedAt) {
        expect(state.results.tally?.results).toHaveLength(1);
      }
    });

    expect(finishedAt).toBeGreaterThan(-1);

    const order = ["queued", "running", "finished"];

    for (const name of SENSORS) {
      let rank = 0;

      for (const state of seen) {
        const now =
          state.run?.plugins.find((one) => one.name === name)?.state ??
          "queued";
        const next = order.indexOf(now);

        expect(next).toBeGreaterThanOrEqual(rank);
        rank = next;
      }
    }
  });

  it("a failed catalog read keeps every registered plugin", () => {
    const fakes = fakesWith(...SENSORS);
    const holder = holderOver(fakes);

    fakes.findings.save(ROOT, findingsOf("tally", { "a.py": "h1" }));
    fakes.active.start({ sensors: SENSORS, phase: "running" });
    holder.refresh();

    const before = holder.current();

    fakes.catalog.failReads = true;
    holder.refresh();

    const after = holder.current();

    expect(after.revision).toBe(before.revision + 1);
    expect(after.registry.catalog.state).toBe("unreadable");
    expect(after.registry.entries.map(({ name }) => name)).toEqual(SENSORS);
    expect(after.registry.entries[0]?.manifest).not.toBeNull();
    expect(after.results).toEqual(before.results);
  });

  it("a catalog read with one unreadable PATH folder keeps the earlier installed set and every registered plugin", () => {
    const fakes = fakesWith(...SENSORS);
    const holder = holderOver(fakes);

    holder.refresh();

    const before = holder.current();

    fakes.sensors.installed.delete("ledger");
    fakes.catalog.unreadable.push("/opt/plugins");
    holder.refresh();

    const after = holder.current();

    expect(after.registry.catalog.state).toBe("read");
    expect(after.registry).toEqual(before.registry);
    expect(after.registry.entries.map(({ name }) => name)).toEqual(SENSORS);
    expect(
      after.registry.entries.every(({ manifest }) => manifest !== null),
    ).toBe(true);
  });

  it("an unreadable PATH folder on the first read leaves the catalog read when every registered plugin is found", () => {
    const fakes = fakesWith(...SENSORS);
    const holder = holderOver(fakes);

    fakes.catalog.unreadable.push("/var/run/system/bin");
    holder.refresh();

    const state = holder.current();

    expect(state.registry.catalog.state).toBe("read");
    expect(state.registry.entries.map(({ name }) => name)).toEqual(SENSORS);
    expect(
      state.registry.entries.every(({ manifest }) => manifest !== null),
    ).toBe(true);
  });

  it("an unreadable PATH folder on the first read marks the catalog unreadable and keeps every registered plugin", () => {
    const fakes = fakesWith(...SENSORS);
    const holder = holderOver(fakes);

    fakes.config.uninstalled.push("absent");
    fakes.catalog.unreadable.push("/opt/plugins");
    holder.refresh();

    const state = holder.current();

    expect(state.registry.catalog.state).toBe("unreadable");
    expect(state.registry.entries.map(({ name }) => name)).toEqual([
      ...SENSORS,
      "absent",
    ]);
  });

  it("a service restart rebuilds the same state", () => {
    const fakes = fakesWith(...SENSORS);
    const old = holderOver(fakes);

    fakes.findings.save(ROOT, findingsOf("tally", { "a.py": "h1" }));
    fakes.active.start({ sensors: SENSORS, phase: "running" });
    fakes.active.report(started("tally"), ended("tally"), started("margin"));
    old.refresh();
    old.refresh();

    const restarted = holderOver(fakes);

    expect(restarted.current().revision).toBe(1);
    expect(withoutRevision(restarted.current())).toEqual(
      withoutRevision(old.current()),
    );
  });

  it("a revision is published only on change", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.active.start({ sensors: ["tally"], phase: "running" });
    holder.refresh();
    holder.refresh();

    expect(holder.current().revision).toBe(1);

    fakes.active.report(started("tally"));
    holder.refresh();

    expect(holder.current().revision).toBe(2);
  });

  it("a killed run ends stopped once", () => {
    const fakes = fakesWith("tally", "margin");
    const holder = holderOver(fakes);

    fakes.runLog.openRecord("run-1");
    fakes.active.start({ sensors: ["tally", "margin"], phase: "running" });
    fakes.active.report(started("tally"));
    fakes.active.kill();
    holder.refresh();

    const state = holder.current();

    expect(state.run?.state).toBe("stopped");
    expect(state.run?.plugins.map(({ state: one }) => one)).toEqual([
      "stopped",
      "stopped",
    ]);
    expect(fakes.runLog.settledKills).toHaveLength(1);
    expect(fakes.runLog.settledKills[0]?.running).toEqual(["tally"]);
    expect(fakes.active.settled).toEqual(["run-1"]);

    holder.refresh();
    holder.refresh();

    expect(fakes.runLog.settledKills).toHaveLength(1);
    expect(fakes.active.settled).toHaveLength(1);
    expect(fakes.runLog.records).toEqual([
      { runId: "run-1", outcome: "stopped", stopped: ["tally"] },
    ]);
  });

  it("a failed settle is retried and deletes nothing", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.runLog.openRecord("run-1");
    fakes.runLog.failSettles = 1;
    fakes.active.start({ sensors: ["tally"], phase: "running" });
    fakes.active.report(started("tally"));
    fakes.active.kill();
    holder.refresh();

    expect(holder.current().run?.state).toBe("stopped");
    expect(fakes.runLog.records).toEqual([
      { runId: "run-1", outcome: "running", stopped: [] },
    ]);
    expect(fakes.active.settled).toEqual([]);

    holder.refresh();

    expect(fakes.runLog.records).toEqual([
      { runId: "run-1", outcome: "stopped", stopped: ["tally"] },
    ]);
    expect(fakes.active.settled).toEqual(["run-1"]);
  });

  it("a marker settle that fails after the log settled does not write the log twice", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.active.failSettles = 1;
    fakes.active.start({ sensors: ["tally"], phase: "running" });
    fakes.active.kill();
    holder.refresh();
    holder.refresh();

    expect(fakes.runLog.settledKills).toHaveLength(1);
    expect(fakes.active.settled).toEqual(["run-1"]);
  });

  it("a config change republishes the registry", () => {
    const fakes = fakesWith(...SENSORS);
    const holder = holderOver(fakes);

    fakes.findings.save(ROOT, findingsOf("margin", { "a.py": "h1" }));
    holder.refresh();

    const before = holder.current();

    expect(Object.keys(before.results)).toEqual(SENSORS);

    const sensor = fakes.sensors.installed.get("margin");

    if (sensor !== undefined) {
      sensor.registered = false;
    }

    fakes.config.held = "sensors: {}";
    holder.refresh();

    const after = holder.current();

    expect(after.revision).toBeGreaterThan(before.revision);
    expect(
      after.registry.entries
        .filter(({ registered }) => registered)
        .map(({ name }) => name),
    ).toEqual(["tally", "ledger"]);
    expect(Object.keys(after.results)).toEqual(["tally", "ledger"]);
    expect(Object.keys(after.freshness)).toEqual(["tally", "ledger"]);
    expect(fakes.findings.stored.has("margin")).toBe(true);
    expect(fakes.findings.removed).toEqual([]);

    if (sensor !== undefined) {
      sensor.registered = true;
    }

    fakes.config.held = "sensors: {margin: {}}";
    holder.refresh();

    expect(holder.current().results.margin?.results).toHaveLength(1);
  });

  it("a settings error on the first read still lists every registered plugin with the error as its reason", () => {
    const fakes = fakesWith(...SENSORS);

    fakes.config.sensors = [...SENSORS];
    fakes.config.failSensorConfig = "tests: suite unit needs a language";

    const state = holderOver(fakes).current();
    const rows = state.registry.entries.filter(({ registered }) => registered);

    expect(rows.map(({ name }) => name)).toEqual(SENSORS);

    for (const row of rows) {
      expect(row.reason).toBe(
        "the settings cannot be read: tests: suite unit needs a language",
      );
    }
  });

  it("a config that cannot be read keeps the registry", () => {
    const fakes = fakesWith(...SENSORS);
    const holder = holderOver(fakes);

    holder.refresh();

    const before = holder.current();

    fakes.config.failText = true;
    holder.refresh();

    const after = holder.current();

    expect(after.registry.catalog.state).toBe("unreadable");
    expect(after.registry.entries.map(({ name }) => name)).toEqual(
      before.registry.entries.map(({ name }) => name),
    );
    expect(Object.keys(after.results)).toEqual(SENSORS);
  });

  it("a commit-scoped run keeps its results beside the working tree's", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.findings.save(ROOT, findingsOf("tally", { "a.py": "h1" }));

    const saved = fakes.findings.saved.length;

    fakes.active.start({
      sensors: ["tally"],
      phase: "running",
      scope: { kind: "commit", commit: "abc123" },
    });
    holder.refresh();

    const before = holder.current().results.tally?.results[0];

    fakes.active.report(started("tally"), {
      kind: "plugin-result",
      name: "tally",
      at: { commit: "abc123", modified: false },
      result: reportedResult(),
    });
    holder.refresh();

    const results = holder.current().results.tally?.results ?? [];

    expect(results.map(({ commit }) => commit).sort()).toEqual([
      "abc123",
      "c0ffee",
    ]);
    expect(results.find(({ commit }) => commit === "c0ffee")).toEqual(before);
    expect(fakes.findings.saved).toHaveLength(saved);
  });

  it("a report that would break an invariant is dropped and counted", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.active.start({ sensors: ["tally"], phase: "running" });
    fakes.active.report(started("tally"), ended("tally"));
    holder.refresh();

    const before = holder.current();

    fakes.active.report(started("tally"));
    holder.refresh();

    const after = holder.current();

    expect(after.run).toEqual(before.run);
    expect(after.unreadableReports).toBe(before.unreadableReports + 1);

    fakes.active.report({ kind: "unreadable" });
    holder.refresh();

    expect(holder.current().unreadableReports).toBe(
      after.unreadableReports + 1,
    );
  });

  it("an unreadable marker leaves the state as it was", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.active.start({ sensors: ["tally"], phase: "running" });
    holder.refresh();

    const before = holder.current();

    fakes.active.kind = "unreadable";
    holder.refresh();

    expect(holder.current()).toEqual(before);
  });

  it("an ended run is named until the marker goes", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.active.start({ sensors: ["tally"], phase: "running" });
    fakes.active.report(started("tally"), ended("tally"));
    fakes.active.end("finished");
    holder.refresh();

    expect(holder.current().run?.state).toBe("finished");

    fakes.active.clear();
    holder.refresh();

    expect(holder.current().run).toBeNull();
  });

  it("an_uncommitted_test_edit_makes_a_result_stale", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.structure.save(ROOT, "python", structureOf({ "a.py": "h1" }));
    fakes.findings.save(
      ROOT,
      findingsOf("tally", { "a.py": "h1" }, { tests: "t1" }),
    );
    fakes.currentTests.held = "t1";
    holder.refresh();

    expect(holder.current().freshness.tally?.state).toBe("current");

    fakes.currentTests.held = "t2";
    holder.workingTreeChanged();

    expect(holder.current().freshness.tally?.state).toBe("stale");
  });

  it("a_rerun_result_replaces_the_working_trees_earlier_result_and_reads_current", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.structure.save(ROOT, "python", structureOf({ "a.py": "h2" }));
    fakes.findings.save(
      ROOT,
      findingsOf(
        "tally",
        { "a.py": "h1" },
        { tests: "t1", modified: true, reportedAt: undefined },
      ),
    );
    fakes.currentTests.held = "t2";
    holder.refresh();

    expect(holder.current().freshness.tally?.state).toBe("stale");

    fakes.findings.save(
      ROOT,
      findingsOf(
        "tally",
        { "a.py": "h2" },
        { tests: "t2", modified: false, reportedAt: undefined },
      ),
    );
    holder.refresh();

    expect(holder.current().results.tally?.results).toHaveLength(1);
    expect(holder.current().freshness.tally?.state).toBe("current");
  });

  it("a_commit_scoped_result_never_stands_in_for_the_working_trees_freshness", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.structure.save(ROOT, "python", structureOf({ "a.py": "h1" }));
    fakes.findings.save(
      ROOT,
      findingsOf(
        "tally",
        { "a.py": "h1" },
        { tests: "t1", reportedAt: undefined },
      ),
    );
    fakes.currentTests.held = "t1";
    fakes.active.start({
      sensors: ["tally"],
      phase: "running",
      scope: { kind: "commit", commit: "ffffff" },
    });
    holder.refresh();
    fakes.active.report(started("tally"), {
      kind: "plugin-result",
      name: "tally",
      at: { commit: "ffffff", modified: false },
      result: reportedResult({ reportedAt: null }),
    });
    holder.refresh();

    expect(holder.current().results.tally?.results).toHaveLength(2);
    expect(holder.current().freshness.tally?.state).toBe("current");
  });

  it("a_digest_read_waits_for_its_verification_before_it_changes_what_is_published", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.structure.save(ROOT, "python", structureOf({ "a.py": "h1" }));
    fakes.findings.save(
      ROOT,
      findingsOf("tally", { "a.py": "h1" }, { tests: "t1" }),
    );
    fakes.currentTests.held = "t1";
    holder.refresh();

    fakes.currentTests.held = "t2";
    holder.readTestsDigest();
    holder.refresh();

    expect(holder.current().freshness.tally?.state).toBe("current");

    holder.verifyTestsDigest();

    expect(holder.current().freshness.tally?.state).toBe("stale");
  });

  it("a_failed_digest_read_keeps_the_last_good_digest_and_is_retried_on_the_next_refresh", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.structure.save(ROOT, "python", structureOf({ "a.py": "h1" }));
    fakes.findings.save(
      ROOT,
      findingsOf("tally", { "a.py": "h1" }, { tests: "t1" }),
    );
    fakes.currentTests.held = "t1";
    holder.refresh();

    expect(holder.current().freshness.tally?.state).toBe("current");

    fakes.currentTests.held = "t2";
    fakes.currentTests.failures = 1;
    holder.workingTreeChanged();

    expect(holder.current().freshness.tally?.state).toBe("current");

    holder.refresh();

    expect(holder.current().freshness.tally?.state).toBe("stale");
  });

  it("a_null_current_digest_keeps_the_held_digest", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.structure.save(ROOT, "python", structureOf({ "a.py": "h1" }));
    fakes.findings.save(
      ROOT,
      findingsOf("tally", { "a.py": "h1" }, { tests: "t1" }),
    );
    fakes.currentTests.held = null;
    holder.refresh();

    expect(holder.current().freshness.tally?.state).toBe("current");
  });

  it("a_null_digest_after_an_edit_is_read_again_so_the_edit_still_reads_stale", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.structure.save(ROOT, "python", structureOf({ "a.py": "h1" }));
    fakes.findings.save(
      ROOT,
      findingsOf("tally", { "a.py": "h1" }, { tests: "t1" }),
    );
    fakes.currentTests.held = "t1";
    holder.refresh();

    fakes.currentTests.held = null;
    holder.workingTreeChanged();

    expect(holder.current().freshness.tally?.state).toBe("current");

    fakes.currentTests.held = "t2";
    holder.refresh();

    expect(holder.current().freshness.tally?.state).toBe("stale");
  });

  it("an_overlay_reference_is_published_and_an_unreadable_overlay_is_kept", () => {
    const fakes = fakesWith("tally", "margin");
    const holder = holderOver(fakes);

    fakes.findings.save(ROOT, findingsOf("tally", { "a.py": "h1" }));
    fakes.findings.save(ROOT, findingsOf("margin", { "a.py": "h1" }));
    fakes.findings.storedOverlays.set("tally", {
      name: "tally",
      status: "read",
      text: "{}",
    });
    fakes.findings.storedOverlays.set("margin", {
      name: "margin",
      status: "read",
      text: "{}",
    });
    holder.refresh();

    expect(holder.current().results.tally?.results[0]?.overlay).toBe(
      "overlay:tally",
    );

    fakes.findings.storedOverlays.set("margin", {
      name: "margin",
      status: "invalid",
      reason: "bad",
    });
    holder.refresh();

    const state = holder.current();

    expect(state.results.margin?.results[0]?.unreadable).toBe(true);
    expect(state.results.margin?.results[0]?.overlay).toBe("overlay:margin");
    expect(state.results.margin?.unreadable).toBe(1);
    expect(state.results.tally?.unreadable).toBe(0);
  });

  it("a_manifest_carries_every_field_the_app_renders", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);
    const sensor = fakes.sensors.installed.get("tally");

    expect(sensor).toBeDefined();

    holder.refresh();

    const manifest = holder.current().registry.entries[0]?.manifest;

    expect(manifest).toMatchObject({
      display: "TALLY",
      runsTests: false,
      scoped: false,
      listed: true,
      metrics: [],
      findings: [],
      settings: [],
    });
  });

  it("a_policy_config_or_baseline_change_publishes_a_revision", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    holder.refresh();
    holder.refresh();

    const first = holder.current();
    const digests = new Set([first.inputsDigest]);

    fakes.policy.heldText = "rules: []";
    holder.refresh();
    expect(holder.current().revision).toBe(first.revision + 1);
    digests.add(holder.current().inputsDigest);

    fakes.config.held = "sensors: {tally: {}}";
    holder.refresh();
    expect(holder.current().revision).toBe(first.revision + 2);
    digests.add(holder.current().inputsDigest);

    fakes.baseline.textHash = "changed";
    holder.refresh();
    expect(holder.current().revision).toBe(first.revision + 3);
    digests.add(holder.current().inputsDigest);

    holder.refresh();
    expect(holder.current().revision).toBe(first.revision + 3);
    expect(digests.size).toBe(4);
  });

  it("a_stage_and_estimate_reach_the_snapshot", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.active.start({ sensors: ["tally"], phase: "running" });
    fakes.active.report(
      started("tally"),
      {
        kind: "plugin-stage",
        name: "tally",
        stage: { name: "Coverage run", index: 1, of: 2 },
      },
      { kind: "plugin-estimate", name: "tally", estimateMs: 7_200_000 },
    );
    holder.refresh();

    const plugin = holder.current().run?.plugins[0];

    expect(plugin?.stage).toEqual({ name: "Coverage run", index: 1, of: 2 });
    expect(plugin?.estimateMs).toBe(7_200_000);
  });

  it("an_estimate_survives_a_stage_change", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.active.start({ sensors: ["tally"], phase: "running" });
    fakes.active.report(
      started("tally"),
      {
        kind: "plugin-stage",
        name: "tally",
        stage: { name: "one", index: 1, of: 2 },
      },
      { kind: "plugin-estimate", name: "tally", estimateMs: 10_800_000 },
    );
    holder.refresh();
    fakes.active.report({
      kind: "plugin-stage",
      name: "tally",
      stage: { name: "two", index: 2, of: 2 },
    });
    holder.refresh();

    const plugin = holder.current().run?.plugins[0];

    expect(plugin?.stage?.index).toBe(2);
    expect(plugin?.estimateMs).toBe(10_800_000);
  });

  it("a_failed_plugin_publishes_its_failure_in_the_revision_that_ends_it", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);
    const seen: RepositoryState[] = [];

    holder.subscribe((state) => seen.push(state));
    fakes.active.start({ sensors: ["tally"], phase: "running" });
    fakes.active.report(started("tally"), {
      kind: "plugin-ended",
      name: "tally",
      state: "failed",
      failure: {
        reason: "no tests",
        diagnosis: { code: "no-tests", line: "none ran" },
      },
    });
    holder.refresh();

    const states = seen.flatMap(
      (state) => state.run?.plugins.map((one) => one) ?? [],
    );

    expect(states.some(({ state }) => state === "failed")).toBe(true);

    for (const plugin of states) {
      if (plugin.state === "failed") {
        expect(plugin.failure?.reason).toBe("no tests");
        expect(plugin.failure?.diagnosis?.code).toBe("no-tests");
      }
    }
  });

  it("a_stage_past_its_total_is_dropped_and_counted", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);

    fakes.active.start({ sensors: ["tally"], phase: "running" });
    fakes.active.report(started("tally"), {
      kind: "plugin-stage",
      name: "tally",
      stage: { name: "one", index: 1, of: 2 },
    });
    holder.refresh();

    const before = holder.current().unreadableReports;

    fakes.active.report({
      kind: "plugin-stage",
      name: "tally",
      stage: { name: "bad", index: 3, of: 2 },
    });
    holder.refresh();

    const plugin = holder.current().run?.plugins[0];

    expect(plugin?.stage?.name).toBe("one");
    expect(holder.current().unreadableReports).toBe(before + 1);
  });

  it("a_finished_run_never_publishes_stale_freshness_for_what_it_just_measured", () => {
    const fakes = fakesWith("tally");
    const holder = holderOver(fakes);
    const seen: RepositoryState[] = [];

    holder.subscribe((state) => seen.push(state));
    fakes.structure.save(ROOT, "python", structureOf({ "a.py": "h1" }));
    fakes.active.start({ sensors: ["tally"], phase: "running" });
    holder.refresh();
    fakes.active.report(started("tally"));
    holder.refresh();
    fakes.findings.save(
      ROOT,
      findingsOf("tally", { "a.py": "h1" }, { reportedAt: undefined }),
    );
    fakes.active.report(ended("tally"));
    holder.refresh();
    fakes.active.end("finished");
    holder.refresh();

    const from = seen.findIndex((state) => state.run?.state === "finished");

    expect(from).toBeGreaterThan(-1);

    for (const state of seen.slice(from)) {
      expect(state.freshness.tally?.state).toBe("current");
    }

    const revisions = seen.map(({ revision }) => revision);

    expect(new Set(revisions).size).toBe(revisions.length);
  });
});
