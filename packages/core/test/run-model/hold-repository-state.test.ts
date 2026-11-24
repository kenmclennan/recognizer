import { describe, expect, it } from "vitest";
import type { RepositoryState, RunReport } from "../../src/index.js";
import {
  fakesWith,
  findingsOf,
  holderOver,
  ROOT,
  reportedResult,
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

  it("an unreadable PATH folder on the first read marks the catalog unreadable and keeps every registered plugin", () => {
    const fakes = fakesWith(...SENSORS);
    const holder = holderOver(fakes);

    fakes.catalog.unreadable.push("/opt/plugins");
    holder.refresh();

    const state = holder.current();

    expect(state.registry.catalog.state).toBe("unreadable");
    expect(state.registry.entries.map(({ name }) => name)).toEqual(SENSORS);
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
      { runId: "run-1", outcome: "failed", stopped: ["tally"] },
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
      { runId: "run-1", outcome: "failed", stopped: ["tally"] },
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
});
