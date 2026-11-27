import type { PluginRunView, RepositoryState, RunView } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import {
  acceptRevision,
  catalogView,
  installedSensorsOf,
  lastFinishedAt,
  panelChanged,
  ranAtOf,
  registeredRows,
  runActivity,
  sensorRows,
  storedResultsOf,
} from "../../src/repository-state-model";

function entry(name: string, registered = true, manifest = true) {
  return {
    name,
    registered,
    manifest: manifest
      ? {
          display: name.toUpperCase(),
          runsTests: false,
          scoped: false,
          listed: true,
        }
      : null,
    reason: manifest ? null : "the plugin is not installed",
  };
}

function plugin(name: string, state: PluginRunView["state"]): PluginRunView {
  return {
    name,
    phase: "sense",
    state,
    progress: null,
    stage: null,
    estimateMs: null,
    effectiveEstimate: null,
    failure: null,
    tally: null,
    durationMs: null,
  };
}

function run(
  state: RunView["state"],
  plugins: PluginRunView[],
  startedBy: RunView["startedBy"] = "app",
): RunView {
  return {
    id: "run-1",
    startedBy,
    startedAt: "2026-11-24T10:00:00Z",
    scope: { kind: "working-tree" },
    sensors: plugins.map(({ name }) => name),
    describe: false,
    suites: {},
    state,
    endedAt: null,
    exit: null,
    gaps: [],
    failure: null,
    ran: null,
    plugins,
    remaining: null,
    confirmation: null,
    describeHalt: null,
    structure: null,
    log: null,
  };
}

function snapshot(
  revision: number,
  names: string[],
  extra: Partial<RepositoryState> = {},
): RepositoryState {
  return {
    repository: "/repo",
    revision,
    registry: {
      catalog: { state: "read" },
      entries: names.map((n) => entry(n)),
    },
    run: null,
    results: {},
    freshness: {},
    unreadableReports: 0,
    inputsDigest: "d",
    ...extra,
  };
}

function resultFor(name: string, unreadable = false) {
  return {
    [name]: {
      unreadable: unreadable ? 1 : 0,
      results: [
        {
          commit: "abc",
          modified: true,
          findings: `findings:${name}`,
          overlay: `overlay:${name}`,
          inputsDigest: "i",
          testsDigest: "t",
          reportedAt: "2026-11-24T10:00:00Z",
          unreadable,
        },
      ],
    },
  };
}

describe("repository state model", () => {
  it("a registration change between revisions removes that plugins row and keeps the others", () => {
    const before = snapshot(5, ["crap", "mutation"], {
      results: resultFor("crap"),
    });
    const after = snapshot(6, ["crap"], { results: resultFor("crap") });

    const rowsBefore = sensorRows(before);
    const rowsAfter = sensorRows(after);

    expect(rowsBefore.map((row) => row.name)).toEqual(["crap", "mutation"]);
    expect(rowsAfter.map((row) => row.name)).toEqual(["crap"]);
    expect(rowsAfter[0]).toEqual(rowsBefore[0]);
  });

  it("a registered plugin is always a row", () => {
    const state = snapshot(1, ["crap", "mutation", "structure"]);

    expect(registeredRows(state).map((row) => row.name)).toEqual([
      "crap",
      "mutation",
      "structure",
    ]);
  });

  it("a row without a manifest shows its reason", () => {
    const state = snapshot(1, []);

    state.registry.entries = [entry("ghost", true, false)];

    const [row] = sensorRows(state);

    expect(row?.name).toBe("ghost");
    expect(row?.display).toBe("ghost");
    expect(row?.reason).toBe("the plugin is not installed");
  });

  it("rows do not change across a run", () => {
    const names = ["crap", "mutation", "structure"];
    const idle = sensorRows(snapshot(1, names)).map((row) => row.name);
    const during = sensorRows(
      snapshot(2, names, {
        run: run("running", [
          plugin("crap", "finished"),
          plugin("mutation", "running"),
          plugin("structure", "queued"),
        ]),
        results: resultFor("crap"),
      }),
    ).map((row) => row.name);
    const after = sensorRows(
      snapshot(3, names, {
        run: run("finished", [
          plugin("crap", "finished"),
          plugin("mutation", "finished"),
          plugin("structure", "finished"),
        ]),
      }),
    ).map((row) => row.name);

    expect(idle).toEqual(names);
    expect(during).toEqual(names);
    expect(after).toEqual(names);
  });

  it("an unreadable findings file is shown unreadable and kept", () => {
    const [row] = sensorRows(
      snapshot(1, ["crap"], { results: resultFor("crap", true) }),
    );

    expect(row?.unreadable).toBe(true);
    expect(row?.status).toBe("failed");
  });

  it("an unreadable catalog shows unavailable with every registered row", () => {
    const state = snapshot(1, ["crap", "mutation"]);

    state.registry.catalog = { state: "unreadable", reason: "no sensors" };

    expect(catalogView(state)).toEqual({
      state: "unavailable",
      reason: "no sensors",
    });
    expect(registeredRows(state)).toHaveLength(2);
  });

  it("an older revision is ignored", () => {
    const first = acceptRevision(null, "r1", snapshot(5, ["crap"]));
    const second = acceptRevision(
      first,
      "r1",
      snapshot(4, ["crap", "mutation"]),
    );

    expect(second.state.revision).toBe(5);
    expect(sensorRows(second.state)).toHaveLength(1);
  });

  it("a revision on a new stream replaces a higher one", () => {
    const first = acceptRevision(null, "r1", snapshot(9, ["crap"]));
    const second = acceptRevision(
      first,
      "r2",
      snapshot(1, ["crap", "mutation"]),
    );

    expect(second.state.revision).toBe(1);
  });

  it("busy_and_external_come_from_the_run", () => {
    const idle = snapshot(1, ["crap"]);
    const own = snapshot(2, ["crap"], {
      run: run("running", [plugin("crap", "running")], "app"),
    });
    const cli = snapshot(3, ["crap"], {
      run: run("running", [plugin("crap", "running")], "cli"),
    });
    const ended = snapshot(4, ["crap"], {
      run: run("finished", [plugin("crap", "finished")], "cli"),
    });

    expect(runActivity(idle, false)).toEqual({ busy: false, external: false });
    expect(runActivity(own, true)).toEqual({ busy: true, external: false });
    expect(runActivity(cli, false)).toEqual({ busy: true, external: true });
    expect(runActivity(own, false)).toEqual({ busy: true, external: true });
    expect(runActivity(ended, false)).toEqual({ busy: false, external: false });
  });

  it("a stale freshness shows the row stale and a plugin without results shows not run", () => {
    const state = snapshot(1, ["crap", "mutation"], {
      results: resultFor("crap"),
      freshness: { crap: { state: "stale", outOfDate: ["tests"] } },
    });
    const rows = sensorRows(state);

    expect(rows[0]?.status).toBe("stale");
    expect(rows[1]?.status).toBe("not run");
  });

  it("a_finished_run_with_current_freshness_reads_ran_not_stale", () => {
    const finished = {
      ...run("finished", [plugin("crap", "finished")]),
      endedAt: "2026-11-24T10:05:00Z",
      exit: 0,
    };
    const state = snapshot(4, ["crap"], {
      run: finished,
      results: resultFor("crap"),
      freshness: { crap: { state: "current", outOfDate: [] } },
    });

    expect(sensorRows(state)[0]?.status).toBe("ran");
  });
});

describe("the installed sensors and stored results the app reads from a snapshot", () => {
  it("lists every registry manifest with the fields the app renders, in registry order", () => {
    const state = snapshot(1, ["crap", "mutation"], {
      registry: {
        catalog: { state: "read" },
        entries: [
          {
            name: "crap",
            registered: true,
            manifest: {
              display: "C.R.A.P.",
              runsTests: true,
              scoped: true,
              listed: true,
              description: "d",
              settingsTitle: "T",
              plannedWork: { verb: "run" },
              logPath: "x.log",
              metrics: [{ name: "m" }],
              findings: [],
              settings: [{ key: "k" }],
            },
            reason: null,
          },
          entry("mutation", false),
          entry("ghost", true, false),
        ],
      },
    });
    const list = installedSensorsOf(state);

    expect(list.status).toBe("ok");

    if (list.status !== "ok") {
      return;
    }

    expect(list.sensors.map(({ name }) => name)).toEqual(["crap", "mutation"]);
    expect(list.sensors[0]).toMatchObject({
      display: "C.R.A.P.",
      description: "d",
      settings_title: "T",
      plannedWork: { verb: "run" },
      logPath: "x.log",
      runsTests: true,
      scoped: true,
      metrics: [{ name: "m" }],
      settings: [{ key: "k" }],
    });
  });

  it("reads an unreadable catalog as unavailable with its reason", () => {
    const state = snapshot(1, ["crap"], {
      registry: {
        catalog: { state: "unreadable", reason: "no recognizer" },
        entries: [entry("crap")],
      },
    });

    expect(installedSensorsOf(state)).toEqual({
      status: "unavailable",
      reason: "no recognizer",
    });
  });

  it("splits texts into findings and overlay files, flags a problem as refused and stamps the reported time", () => {
    const stored = storedResultsOf({
      revision: 2,
      refusals: {},
      lastRun: null,
      plugins: {
        crap: {
          findings: { commit: "f" } as never,
          overlay: { commit: "o" } as never,
          findingsProblem: null,
          overlayProblem: null,
          modifiedMs: Date.parse("2026-11-24T10:00:00Z"),
          freshness: null,
          shown: [],
          hidden: [],
          measured: ["a.py"],
          suites: [
            {
              name: "unit",
              kind: "ok",
              at: 1,
              measured: 0,
              total: 0,
              reason: null,
            },
          ],
        },
        mutation: {
          findings: null,
          overlay: null,
          findingsProblem: "bad",
          overlayProblem: "worse",
          modifiedMs: null,
          freshness: null,
          shown: null,
          hidden: null,
          measured: null,
          suites: null,
        },
      },
    });

    expect(stored.findings.files).toEqual([
      {
        name: "crap",
        document: { commit: "f" },
        modifiedMs: Date.parse("2026-11-24T10:00:00Z"),
        shown: [],
        hidden: [],
        measured: ["a.py"],
        suites: [
          {
            name: "unit",
            kind: "ok",
            at: 1,
            measured: 0,
            total: 0,
            reason: null,
          },
        ],
      },
    ]);
    expect(stored.findings.refused).toEqual(["mutation"]);
    expect(stored.overlays.files.map(({ name }) => name)).toEqual(["crap"]);
    expect(stored.overlays.refused).toEqual(["mutation"]);
  });
});

describe("the run card reads the snapshot's last finished run", () => {
  const finished = (endedAt: string | null, state: RunView["state"]) =>
    snapshot(3, ["crap"], {
      run: {
        id: "r",
        startedBy: "app",
        startedAt: "2026-11-25T00:00:00.000Z",
        scope: { kind: "working-tree" },
        sensors: ["crap"],
        describe: false,
        suites: {},
        state,
        endedAt,
        exit: 0,
        gaps: [],
        failure: null,
        ran: null,
        plugins: [],
        remaining: null,
        confirmation: null,
        describeHalt: null,
        structure: null,
        log: null,
      },
    });

  it("a_run_finished_after_the_scan_was_loaded_moves_the_ran_time_forward", () => {
    const state = finished("2026-11-25T01:00:00.000Z", "finished");
    const loaded = Date.parse("2026-11-25T00:15:00.000Z");

    expect(lastFinishedAt(state)).toBe(Date.parse("2026-11-25T01:00:00.000Z"));
    expect(ranAtOf(loaded, state)).toBe(Date.parse("2026-11-25T01:00:00.000Z"));
  });

  it("a_run_that_is_not_finished_or_older_than_the_scan_leaves_the_ran_time_alone", () => {
    const loaded = Date.parse("2026-11-25T02:00:00.000Z");

    expect(lastFinishedAt(finished(null, "running"))).toBeNull();
    expect(
      lastFinishedAt(finished("2026-11-25T01:00:00.000Z", "stopped")),
    ).toBeNull();
    expect(lastFinishedAt(null)).toBeNull();
    expect(
      ranAtOf(loaded, finished("2026-11-25T01:00:00.000Z", "finished")),
    ).toBe(loaded);
  });

  it("a_newly_finished_run_changes_the_panel_even_when_nothing_else_did", () => {
    const before = finished(null, "running");
    const after = finished("2026-11-25T01:00:00.000Z", "finished");

    expect(panelChanged(before, after)).toBe(true);
  });
});
