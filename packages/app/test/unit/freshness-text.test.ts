import { readFileSync } from "node:fs";
import type {
  RunState as CoreRunState,
  PluginRunState,
  RunView,
} from "@recognizer/core";
import { unregisteredMessage } from "recognizer";
import { describe, expect, it } from "vitest";
import type { FileChange, ScanState } from "../../src/footer-scan";
import {
  type FreshnessModel,
  findingsActionOf,
  type ResultState,
  stateText,
  wordFreshness,
} from "../../src/freshness-text";
import { DESCRIBE_KEY, freshnessMessage } from "../../src/scan-freshness";
import {
  NO_RUN,
  type PanelInput,
  type RowSensor,
  type RunState,
} from "../../src/scan-panel-model";
import type { SensorStatus } from "../../src/sensor-run";
import { configOf, withPlan } from "../fixtures";
import { factsFor } from "../freshness-support";
import { type DocScan, repositoryFrom } from "./repository-from";

const MINUTE = 60000;
const NOW = 100 * MINUTE;

const SENSORS: RowSensor[] = [
  {
    name: "crap",
    display: "C.R.A.P.",
    title: "",
    runsTests: true,
    scoped: false,
    registered: true,
  },
  {
    name: "mutation",
    display: "Mutation",
    title: "",
    runsTests: true,
    scoped: true,
    registered: true,
  },
];

function scanOf(ids: string[]): DocScan {
  return {
    modules: ids.map((id) => ({
      id,
      kind: "module",
      members: [{ name: "f", exported: true, kind: "function" }],
    })),
    edges: [],
    foreign: [],
    files: ids.map((path) => ({ path, hash: `h-${path}` })),
  } as unknown as DocScan;
}

function scanState(files: FileChange[] = [], moved = false): ScanState {
  return {
    origin: { branch: "main", commit: "abc1234" },
    scannedAt: NOW - 16 * MINUTE,
    changes: {
      files,
      moved: moved ? { branch: "main", commit: "def5678" } : null,
    },
    scanning: null,
  };
}

function ran(
  name: string,
  ids: string[],
  hashes: Record<string, string> = {},
  excluded?: { functions: number; files: string[] },
  unowned?: { functions: number; files: string[] },
): PanelInput["sensors"][number] {
  return {
    ...(excluded !== undefined ? { excluded } : {}),
    ...(unowned !== undefined ? { unowned } : {}),
    name,
    status: "ran",
    findings: 0,
    modifiedMs: NOW - 16 * MINUTE,
    measured: {
      inputs: Object.fromEntries(
        ids.map((id) => [id, hashes[id] ?? `h-${id}`]),
      ),
      tests: "t",
    },
  };
}

function withAnalysis(given: PanelInput["sensors"]): PanelInput["sensors"] {
  return given.some(({ name }) => name === "structure")
    ? given
    : [{ name: "structure", status: "ran" }, ...given];
}

function modelOf(
  ids: string[],
  over: Partial<PanelInput> = {},
  sensors: RowSensor[] = SENSORS,
): FreshnessModel {
  const planned = plannedInput(ids, over, sensors);

  return wordFreshness(
    "plan" in over ? { ...planned, plan: over.plan } : planned,
    sensors,
  );
}

function plannedInput(
  ids: string[],
  over: Partial<PanelInput>,
  sensors: RowSensor[],
): PanelInput {
  const scan = scanOf(ids);
  const input: PanelInput = {
    scan: scanState(),
    config: configOf("describer:\n  command: [describer]\n  version: v1\n"),
    sensors: [ran("crap", ids), ran("mutation", ids)],
    lines: { modules: ids, of: () => ({ kind: "current", line: "x" }) },
    describedAt: NOW - 16 * MINUTE,
    ticks: {
      describe: true,
      analysis: true,
      ticked: [],
      armed: ["crap", "mutation"],
      onlyView: false,
      suites: {},
      folds: [],
    },
    run: NO_RUN,
    scanning: false,
    now: NOW,
    installed: null,
    scans: repositoryFrom([scan]),
    ...over,
  };

  input.sensors = withAnalysis(input.sensors);
  if (!("freshness" in over)) {
    input.freshness = factsFor(repositoryFrom([scan]), input.sensors, "t");
  }

  return withPlan(input, sensors);
}

const run = (over: Partial<RunState>): RunState => ({ ...NO_RUN, ...over });
const kindOf = (model: FreshnessModel, key: string) =>
  model.rows.find((row) => row.key === key)?.state.kind;
const IDS = ["a.py", "b.py", "c.py"];
const UNREGISTERED: RowSensor = {
  name: "alpha",
  display: "Alpha",
  title: "",
  runsTests: false,
  scoped: false,
  registered: false,
};

describe("freshness model file scope", () => {
  const flagged: RowSensor[] = [
    {
      name: "mutation",
      display: "Mutation",
      title: "",
      runsTests: true,
      scoped: false,
      registered: true,
    },
    {
      name: "other",
      display: "Other",
      title: "",
      runsTests: true,
      scoped: true,
      registered: true,
    },
  ];

  it("counts an unlisted file missing for the scoped row only, whatever the rows are called", () => {
    const listed = ["a.py"];
    const model = modelOf(
      IDS,
      {
        sensors: [ran("mutation", listed), ran("other", listed)],
        ticks: {
          describe: false,
          analysis: true,
          ticked: [],
          armed: ["mutation", "other"],
          onlyView: false,
          suites: {},
          folds: [],
        },
      },
      flagged,
    );

    expect(model.rows.find((row) => row.key === "other")?.scoped).toBe(true);
    expect(model.rows.find((row) => row.key === "mutation")?.scoped).toBe(
      false,
    );
    expect(model.gaps.get("other")).toEqual(["b.py", "c.py"]);
    expect(model.gaps.get("mutation") ?? []).toEqual([]);
  });
});

describe("freshness model states", () => {
  it("reads every row current when nothing changed", () => {
    const model = modelOf(IDS);

    expect(model.rows.map((row) => [row.key, row.state.kind])).toEqual([
      ["scan", "current"],
      ["structure", "current"],
      ["describe", "current"],
      ["crap", "current"],
      ["mutation", "current"],
    ]);
    expect(model.rows[0]?.tickable).toBe(false);
  });

  it("reads a row out of date with the files whose hash moved", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS, { "b.py": "old" }), ran("mutation", IDS)],
    });

    expect(model.rows.find((row) => row.key === "crap")?.state).toEqual({
      kind: "out-of-date",
      modules: ["b.py"],
    });
  });

  it("reads a sensor with no result never run, and one that failed failed with its age", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS)],
      run: run({ failures: { crap: "boom" }, ranAt: { crap: NOW - MINUTE } }),
    });

    expect(model.rows.find((row) => row.key === "crap")?.state).toEqual({
      kind: "failed",
      at: NOW - MINUTE,
    });
    expect(kindOf(model, "mutation")).toBe("never-run");
  });

  it("reads a row running with its counts, or without them", () => {
    const model = modelOf(IDS, {
      scanning: true,
      run: run({ running: ["mutation", "crap"], started: "mutation" }),
      sensorProgress: {
        name: "mutation",
        phase: "sense",
        progress: { done: 5, total: 9, unit: "functions" },
      },
    });

    expect(model.rows.find((row) => row.key === "mutation")?.state).toEqual({
      kind: "running",
      done: 5,
      total: 9,
    });
    expect(model.rows.find((row) => row.key === "crap")?.state).toEqual({
      kind: "running",
      done: null,
      total: null,
    });
  });

  it("reads Structure out of date from changed files that are files, ignoring one that is not", () => {
    const model = modelOf(IDS, {
      scan: scanState([
        { path: "b.py", kind: "modified" },
        { path: "README.md", kind: "modified" },
      ]),
    });

    expect(model.rows[0]?.state).toEqual({
      kind: "out-of-date",
      modules: ["b.py"],
    });
    expect(model.changed).toEqual(["b.py"]);
  });

  it("reads Structure out of date for every in-scope file when the commit moved", () => {
    const model = modelOf(IDS, { scan: scanState([], true) });

    expect(model.changed).toEqual(IDS);
  });

  it("reads Structure never run without a scan", () => {
    expect(kindOf(modelOf(IDS, { scan: null }), "structure")).toBe("never-run");
  });
});

describe("freshness model wording", () => {
  const text = (state: ResultState) => stateText(state, NOW);

  it("words each state the same everywhere", () => {
    expect(text({ kind: "current", at: NOW - 16 * MINUTE })).toEqual({
      icon: "circle-check",
      text: "current, 16 minutes ago",
    });
    expect(text({ kind: "out-of-date", modules: ["a"] }).text).toBe(
      "1 file out of date",
    );
    expect(text({ kind: "out-of-date", modules: ["a", "b"] })).toEqual({
      icon: "circle-alert",
      text: "2 files out of date",
    });
    expect(text({ kind: "never-run" })).toEqual({
      icon: "circle-dashed",
      text: "never run",
    });
    expect(text({ kind: "failed", at: NOW - MINUTE })).toEqual({
      icon: "circle-x",
      text: "failed, 1 minute ago",
    });
    expect(text({ kind: "running", done: 251, total: 1204 })).toEqual({
      icon: "loader",
      text: "251 of 1,204",
    });
    expect(text({ kind: "running", done: null, total: null }).text).toBe(
      "running",
    );
  });
});

describe("freshness model changed files", () => {
  it("leaves a never-run row out of changed and counts a ticked out-of-date row in update", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS, { "c.py": "old" })],
    });

    expect(kindOf(model, "mutation")).toBe("never-run");
    expect(model.update).toEqual(["c.py"]);
    expect(model.changed).toEqual([]);
  });

  it("leaves an unticked out-of-date row out of changed", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS, { "c.py": "old" }), ran("mutation", IDS)],
      ticks: {
        describe: true,
        analysis: true,
        ticked: [],
        armed: ["mutation"],
        onlyView: false,
        suites: {},
        folds: [],
      },
    });

    expect(model.changed).toEqual([]);
  });

  it("answers isChanged from Structure only", () => {
    const model = modelOf(IDS, {
      scan: scanState([{ path: "a.py", kind: "modified" }]),
      sensors: [ran("crap", IDS, { "c.py": "old" }), ran("mutation", IDS)],
    });

    expect(model.isChanged("a.py")).toBe(true);
    expect(model.isChanged("c.py")).toBe(false);
    expect(model.changed).toEqual(["a.py"]);
    expect(model.update).toEqual(["a.py", "c.py"]);
  });
});

describe("freshness model sensor gaps and excluded files", () => {
  const MUTATION_NO_RESULT = "Mutation has no result for";

  it("reads a sensor-only gap as behind, not changed, and offers the update", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS, { "c.py": "old" }), ran("mutation", IDS)],
    });

    expect(model.changed).toEqual([]);
    expect(model.update).toEqual(["c.py"]);
    expect(model.summary.shape).toBe("behind");
    expect(model.summary.head).not.toContain("changed since");
    expect(model.action.primary.label).toBe("Update 1 file");
  });

  it("says changed only of Structure's files and updates both", () => {
    const model = modelOf(IDS, {
      scan: scanState([{ path: "a.py", kind: "modified" }]),
      sensors: [ran("crap", IDS, { "c.py": "old" }), ran("mutation", IDS)],
    });

    expect(model.summary.head).toBe("1 file changed since it was scanned");
    expect(model.action.primary.label).toBe("Update 2 files");
  });

  it("settles a fully excluded file and names it with the reason", () => {
    const model = modelOf(IDS, {
      sensors: [
        ran("crap", IDS),
        ran("mutation", IDS, {}, { functions: 2, files: ["a.py"] }),
      ],
    });

    expect(model.update).toEqual([]);
    expect(model.action.primary.label).toBe("Up to date");
    expect(model.summary.shape).toBe("current");
    expect(
      model.summary.line.endsWith(
        `${MUTATION_NO_RESULT} a.py: its suite's coverage report does not include it.`,
      ),
    ).toBe(true);
  });

  it("settles a file whose functions have no executable line without naming it", () => {
    const model = modelOf(IDS);

    expect(model.update).toEqual([]);
    expect(model.changed).toEqual([]);
    expect(model.action.primary.label).toBe("Up to date");
    expect(model.summary.shape).toBe("current");
    expect(model.summary.line).not.toContain(MUTATION_NO_RESULT);
  });

  it("names only the excluded files in scope and not in the gap", () => {
    const model = modelOf(IDS, {
      sensors: [
        ran("crap", IDS),
        ran(
          "mutation",
          IDS,
          { "c.py": "old" },
          { functions: 3, files: ["a.py", "gone.py", "c.py"] },
        ),
      ],
    });

    expect(model.noResult).toEqual([
      { sensor: "Mutation", reason: "excluded", modules: ["a.py"] },
    ]);
    expect(model.update).toEqual(["c.py"]);
    expect(model.summary.line).toContain(`${MUTATION_NO_RESULT} a.py:`);
    expect(model.summary.line).not.toContain("c.py:");
  });

  it("uses the plural sentence for two excluded files", () => {
    const model = modelOf(IDS, {
      sensors: [
        ran("crap", IDS),
        ran("mutation", IDS, {}, { functions: 2, files: ["a.py", "b.py"] }),
      ],
    });

    expect(model.summary.line).toContain(
      "Mutation has no result for a.py and b.py: their suites' coverage reports do not include them.",
    );
  });

  it("settles a fully unowned file and names it with the unowned reason", () => {
    const model = modelOf(IDS, {
      sensors: [
        ran("crap", IDS),
        ran("mutation", IDS, {}, undefined, {
          functions: 2,
          files: ["a.py"],
        }),
      ],
    });

    expect(model.update).toEqual([]);
    expect(model.action.primary.label).toBe("Up to date");
    expect(model.summary.shape).toBe("current");
    expect(
      model.summary.line.endsWith(
        `${MUTATION_NO_RESULT} a.py: no test suite in .recognizer/config.yaml covers it.`,
      ),
    ).toBe(true);
  });

  it("uses the plural sentence for two unowned files", () => {
    const model = modelOf(IDS, {
      sensors: [
        ran("crap", IDS),
        ran("mutation", IDS, {}, undefined, {
          functions: 2,
          files: ["a.py", "b.py"],
        }),
      ],
    });

    expect(model.summary.line).toContain(
      "Mutation has no result for a.py and b.py: no test suite in .recognizer/config.yaml covers them.",
    );
  });

  it("names a file in both lists under both reasons, excluded first", () => {
    const model = modelOf(IDS, {
      sensors: [
        ran("crap", IDS),
        ran(
          "mutation",
          IDS,
          {},
          { functions: 1, files: ["a.py"] },
          { functions: 1, files: ["a.py"] },
        ),
      ],
    });

    expect(model.noResult.map(({ reason }) => reason)).toEqual([
      "excluded",
      "unowned",
    ]);

    const line = model.summary.line;

    expect(line.indexOf("coverage report")).toBeGreaterThan(-1);
    expect(line.indexOf("coverage report")).toBeLessThan(
      line.indexOf("no test suite in"),
    );
  });

  it("does not name an unowned file that is also out of date", () => {
    const model = modelOf(IDS, {
      sensors: [
        ran("crap", IDS),
        ran("mutation", IDS, { "c.py": "old" }, undefined, {
          functions: 1,
          files: ["c.py"],
        }),
      ],
    });

    expect(model.noResult).toEqual([]);
    expect(model.update).toEqual(["c.py"]);
  });

  it("says nothing about excluded files when the sensor never ran", () => {
    const model = modelOf(IDS, { sensors: [ran("crap", IDS)] });

    expect(kindOf(model, "mutation")).toBe("never-run");
    expect(model.noResult).toEqual([]);
    expect(model.summary.line).not.toContain("has no result");
  });
});

describe("unknown files of the structure row", () => {
  const withUnknown = (
    files: string[],
    hashes: Record<string, string> = {},
  ): PanelInput["sensors"] => [
    {
      name: "structure",
      status: "ran",
      unknownFiles: { languages: ["python"], files },
    },
    ran("crap", IDS, hashes),
    ran("mutation", IDS, hashes),
  ];
  const UNKNOWN_TEXT =
    "no installed scanner publishes rules for python, so their test-file, supertype and private-import findings are unknown, not clean.";

  it("names unknown files of the structure row in the summary", () => {
    const model = modelOf(IDS, { sensors: withUnknown(["a.py", "b.py"]) });

    expect(model.noResult).toContainEqual({
      sensor: "Structural analysis",
      reason: "unknown",
      modules: ["a.py", "b.py"],
      languages: ["python"],
    });
    expect(model.summary.line).toContain(
      `Structural analysis has no result for a.py and b.py: ${UNKNOWN_TEXT}`,
    );
  });

  it("uses the singular for one file", () => {
    const model = modelOf(IDS, { sensors: withUnknown(["a.py"]) });

    expect(model.summary.line).toContain(
      "Structural analysis has no result for a.py: no installed scanner publishes rules for python, so its test-file",
    );
  });

  it("names only in-scope unknown files", () => {
    const model = modelOf(IDS, { sensors: withUnknown(["a.py", "gone.py"]) });

    expect(model.noResult).toContainEqual({
      sensor: "Structural analysis",
      reason: "unknown",
      modules: ["a.py"],
      languages: ["python"],
    });
    expect(model.summary.line).not.toContain("gone.py");
  });

  it("adds nothing when none are unknown", () => {
    const model = modelOf(IDS);

    expect(model.noResult.filter(({ reason }) => reason === "unknown")).toEqual(
      [],
    );
    expect(model.summary.line).not.toContain("unknown, not clean");
  });
});

describe("the four situations of the mock", () => {
  const nine = Array.from({ length: 12 }, (_, at) => `m${at}.py`);
  const changedNine = nine.slice(0, 9).map((path) => ({
    path,
    kind: "modified" as const,
  }));

  it("everything current: Up to date, disabled", () => {
    const model = modelOf(nine);

    expect(model.summary).toMatchObject({
      shape: "current",
      head: "Everything on the repository is current",
      bar: null,
    });
    expect(model.action.primary).toEqual({
      label: "Up to date",
      disabled: true,
    });
  });

  it("9 changed: Update 9 files with the names and no bar", () => {
    const model = modelOf(nine, { scan: scanState(changedNine) });

    expect(model.action.primary).toEqual({
      label: "Update 9 files",
      disabled: false,
    });
    expect(model.summary).toMatchObject({
      shape: "changed",
      head: "9 files changed since they were scanned",
      bar: null,
    });
    expect(model.summary.line).toContain("m0.py, m1.py, m2.py and 6 more");
  });

  it("Mutation running at 251 of 1,204 shows the bar and never says Bringing", () => {
    const model = modelOf(nine, {
      scan: scanState(changedNine),
      scanning: true,
      runModules: 9,
      run: run({ running: ["mutation"], started: "mutation" }),
      sensorProgress: {
        name: "mutation",
        phase: "sense",
        progress: { done: 251, total: 1204, unit: "functions" },
      },
    });

    expect(model.summary.shape).toBe("running");
    expect(model.summary.head).toBe("Running Mutation on 9 files");
    expect(model.summary.line).toContain("251 of 1,204 functions.");
    expect(model.summary.bar).toEqual({ done: 251, total: 1204 });
    expect(JSON.stringify(model)).not.toContain("Bringing");
    expect(model.action.primary).toEqual({ label: "Running", disabled: true });
    expect(model.footer).toBe("Scanning\u2026");
  });

  it("C.R.A.P. failed and Mutation never run: Run C.R.A.P. and Mutation", () => {
    const model = modelOf(nine, {
      sensors: [ran("crap", nine)],
      run: run({ failures: { crap: "x" }, ranAt: { crap: NOW } }),
    });

    expect(model.summary.head).toBe("C.R.A.P. failed; Mutation has never run");
    expect(model.summary.line).toBe(
      "Their values and findings are missing. Structure, Structural analysis and Descriptions are current.",
    );
    expect(model.action.primary.label).toBe("Run C.R.A.P. and Mutation");
    expect(model.summary.bar).toBeNull();
  });

  it("counts only the canvas files for a canvas scope", () => {
    const model = modelOf(nine, {
      view: { name: "x", modules: nine.slice(0, 2) },
      ticks: {
        describe: true,
        analysis: true,
        ticked: [],
        armed: [],
        onlyView: true,
        suites: {},
        folds: [],
      },
      sensors: [],
    });

    expect(model.scopeCount).toBe(2);
  });
});

describe("the running summary without a changed file", () => {
  it("names the in-scope count, never 0, when only a never-run sensor runs", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS)],
      scanning: true,
      run: run({ running: ["mutation"], started: "mutation" }),
    });

    expect(model.summary.head).toBe("Running Mutation on 3 files");
    expect(model.summary.head).not.toContain(" 0 ");
  });

  it("says 1 file on the boundary", () => {
    const model = modelOf(IDS, {
      scanning: true,
      runModules: 1,
      run: run({ running: ["mutation"], started: "mutation" }),
    });

    expect(model.summary.head).toBe("Running Mutation on 1 file");
  });

  it("shows the footer's progress only while a run runs", () => {
    expect(
      modelOf(IDS, { scanning: true, progressText: "Mutation: 5 of 9" }).footer,
    ).toBe("Mutation: 5 of 9");
    expect(
      modelOf(IDS, { progressText: "Mutation: 5 of 9" }).footer,
    ).toBeNull();
  });
});

describe("the findings line and groups", () => {
  it("has no line when everything is current and every group is current", () => {
    const model = modelOf(IDS);

    expect(model.findings).toBeNull();
    expect(model.group("crap")).toBe("current");
    expect(model.group("mutation")).toBe("current");
  });

  it("shows none yet only for sensors with no current result", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS)],
    });

    expect(model.group("crap")).toBe("current");
    expect(model.group("mutation")).toBe("none-yet");
    expect(model.findings).toEqual({
      kind: "missing",
      text: "No Mutation findings: 1 has never run.",
      link: "Run them",
    });
  });

  it("shows none yet for every sensor when none has a result", () => {
    const model = modelOf(IDS, { sensors: [] });

    expect(model.group("crap")).toBe("none-yet");
    expect(model.group("mutation")).toBe("none-yet");
  });

  it("names the hidden changed files before any missing sensor", () => {
    const model = modelOf(IDS, {
      scan: scanState([{ path: "a.py", kind: "modified" }]),
      sensors: [ran("crap", IDS)],
    });

    expect(model.findings).toEqual({
      kind: "hidden",
      text: "Findings for 1 changed file is hidden.",
      link: "Update them",
    });
  });
});

describe("the unscoped stale set per sensor", () => {
  const sorted = (set: ReadonlySet<string> | undefined) => [...(set ?? [])];

  it("holds the same stale files in every row state", () => {
    const stale = { "b.py": "old" };
    const states = {
      current: {},
      running: { run: run({ running: ["crap"] }), scanning: true },
      failed: { run: run({ failures: { crap: "boom" } }) },
    };

    for (const [kind, over] of Object.entries(states)) {
      const model = modelOf(IDS, {
        sensors: [ran("crap", IDS, stale), ran("mutation", IDS)],
        ...over,
      });

      expect(kindOf(model, "crap")).toBe(
        kind === "current" ? "out-of-date" : kind,
      );
      expect(sorted(model.stale.get("crap"))).toEqual(["b.py"]);
    }
  });

  it("covers files outside the view when only this view is on", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS, { "c.py": "old" }), ran("mutation", IDS)],
      ticks: {
        describe: true,
        analysis: true,
        ticked: [],
        armed: ["crap", "mutation"],
        onlyView: true,
        suites: {},
        folds: [],
      },
      view: { name: "v", modules: ["a.py"] } as never,
    });

    expect(kindOf(model, "crap")).toBe("current");
    expect(sorted(model.stale.get("crap"))).toEqual(["c.py"]);
    expect([...model.modules]).toEqual(IDS);
  });

  it("holds every file when the measurement is not valid", () => {
    const model = modelOf(IDS, {
      sensors: [
        {
          ...ran("crap", IDS),
          measured: { inputs: {}, tests: "other" },
        },
        ran("mutation", IDS),
      ],
    });

    expect(sorted(model.stale.get("crap")).sort()).toEqual(IDS);
  });

  it("has no entry for a sensor with no measurement, Descriptions or Structure", () => {
    const model = modelOf(IDS, { sensors: [ran("mutation", IDS)] });

    expect(model.stale.has("crap")).toBe(false);
    expect(model.stale.has("describe")).toBe(false);
    expect(model.stale.has("structure")).toBe(false);
    expect(model.stale.has("mutation")).toBe(true);
  });

  it("has no entry at all without a freshness", () => {
    const model = modelOf(IDS, { freshness: undefined });

    expect(model.stale.size).toBe(0);
  });

  it("keeps a file stale under one sensor out of the other's set", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS, { "a.py": "old" }), ran("mutation", IDS)],
    });

    expect(sorted(model.stale.get("crap"))).toEqual(["a.py"]);
    expect(sorted(model.stale.get("mutation"))).toEqual([]);
  });
});

const srcUrl = new URL("../../src/index.ts", import.meta.url).href;

describe("the model's imports", () => {
  it("takes no port, source or rescanner", () => {
    const source = readFileSync(new URL("./freshness-text.ts", srcUrl), "utf8");

    expect(source).not.toMatch(
      /from "\.\/(rescanner|[a-z-]+-source|[a-z-]+-port)"/,
    );
  });
});

describe("the model over committed content", () => {
  it("names exactly the two changed files, in scope order", () => {
    const scan = JSON.parse(
      readFileSync(
        new URL("../../../fixtures/python/expected-scan.json", srcUrl),
        "utf8",
      ),
    ) as DocScan;
    const ids = scan.modules.map(({ id }) => id);
    const model = modelOf(ids, {
      scans: repositoryFrom([scan]),
      freshness: {},
      sensors: [],
      lines: { modules: ids, of: () => ({ kind: "current", line: "x" }) },
      scan: scanState([
        { path: "shop/domain/order.py", kind: "modified" },
        { path: "shop/application/place.py", kind: "modified" },
      ]),
    });

    expect(model.changed).toEqual([
      "shop/application/place.py",
      "shop/domain/order.py",
    ]);
  });
});

describe("freshness model counts every row, ticked or not", () => {
  const MUTATION_ONLY = {
    describe: true,
    analysis: true,
    ticked: [],
    armed: ["crap"],
    onlyView: false,
    suites: {},
    folds: [],
  };
  const stale = (count: number) =>
    Array.from({ length: count }, (_, at) => `m${at}.py`);

  it("reads an unticked out-of-date sensor as behind and offers nothing to run", () => {
    const ids = stale(42);
    const model = modelOf(ids, {
      sensors: [
        ran("crap", ids),
        ran("mutation", ids, Object.fromEntries(ids.map((id) => [id, "old"]))),
      ],
      ticks: MUTATION_ONLY,
    });

    expect(model.summary.shape).toBe("behind");
    expect(model.summary.tone).toBe("warn");
    expect(model.summary.head).toBe("Mutation is out of date on 42 files");
    expect(model.changed).toEqual([]);
    expect(model.action.primary).toEqual({
      label: "Nothing ticked to run",
      disabled: true,
    });
  });

  it("reads one file in the singular, and Update 1 file once ticked", () => {
    const sensors = [ran("crap", IDS), ran("mutation", IDS, { "a.py": "old" })];
    const unticked = modelOf(IDS, { sensors, ticks: MUTATION_ONLY });
    const ticked = modelOf(IDS, { sensors });

    expect(unticked.summary.head).toBe("Mutation is out of date on 1 file");
    expect(ticked.action.primary.label).toBe("Update 1 file");
  });

  it("reads two unticked out-of-date rows as nothing to run", () => {
    const model = modelOf(IDS, {
      sensors: [
        ran("crap", IDS, { "a.py": "old" }),
        ran("mutation", IDS, { "b.py": "old" }),
      ],
      ticks: {
        describe: true,
        analysis: true,
        ticked: [],
        armed: [],
        onlyView: false,
        suites: {},
        folds: [],
      },
    });

    expect(model.summary.head).toBe(
      "C.R.A.P. is out of date on 1 file; Mutation is out of date on 1 file",
    );
    expect(model.action.primary).toEqual({
      label: "Nothing ticked to run",
      disabled: true,
    });
  });

  it("reads an unticked failed sensor as attention", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS)],
      ticks: MUTATION_ONLY,
      run: run({
        failures: { mutation: "boom" },
        ranAt: { mutation: NOW - MINUTE },
      }),
    });

    expect(model.summary.shape).toBe("attention");
    expect(model.summary.tone).toBe("bad");
    expect(model.summary.head).toBe("Mutation failed");
    expect(model.action.primary.label).toBe("Nothing ticked to run");
    expect(model.action.primary.disabled).toBe(true);
    expect(model.action.primary).not.toHaveProperty("tick");
  });

  it("reads an unticked never-run sensor as attention", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS)],
      ticks: MUTATION_ONLY,
    });

    expect(model.summary.shape).toBe("attention");
    expect(model.summary.tone).toBe("warn");
    expect(model.summary.head).toBe("Mutation has never run");
    expect(model.action.primary.label).toBe("Nothing ticked to run");
    expect(model.action.primary.disabled).toBe(true);
  });

  it("keeps the ticked work first and names the unticked row in the line", () => {
    const model = modelOf(IDS, {
      sensors: [
        ran("crap", IDS, { "a.py": "old" }),
        ran("mutation", IDS, { "b.py": "old" }),
      ],
      ticks: MUTATION_ONLY,
    });

    expect(model.summary.shape).toBe("behind");
    expect(model.summary.line).toContain(
      "Update C.R.A.P. to bring it up to date.",
    );
    expect(model.action.primary.label).toBe("Update 1 file");
    expect(model.update).toEqual(["a.py"]);
  });

  it("names an unticked out-of-date row beside a ticked failed one", () => {
    const model = modelOf(IDS, {
      sensors: [ran("mutation", IDS, { "b.py": "old" })],
      run: run({ failures: { crap: "boom" }, ranAt: { crap: NOW - MINUTE } }),
      ticks: MUTATION_ONLY,
    });

    expect(model.summary.shape).toBe("attention");
    expect(model.summary.line).toContain(
      "Mutation is out of date and not ticked.",
    );
  });

  it("still reads current when every row is current", () => {
    const model = modelOf(IDS, { ticks: MUTATION_ONLY });

    expect(model.summary.shape).toBe("current");
    expect(model.summary.head).toBe("Everything on the repository is current");
    expect(model.action.primary).toEqual({
      label: "Up to date",
      disabled: true,
    });
  });

  it("keeps Rescan in rescan mode", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS), ran("mutation", IDS, { "a.py": "old" })],
      ticks: MUTATION_ONLY,
      mode: "rescan",
    });

    expect(model.action.primary.label).toBe("Rescan 3 files");
  });

  it("never shows Up to date beside a non-current headline, across every combination", () => {
    const options = [
      { sensors: [ran("crap", IDS), ran("mutation", IDS)], run: NO_RUN },
      {
        sensors: [ran("crap", IDS, { "a.py": "old" }), ran("mutation", IDS)],
        run: NO_RUN,
      },
      { sensors: [ran("mutation", IDS)], run: NO_RUN },
      { sensors: [], run: NO_RUN, listed: [UNREGISTERED] },
      {
        sensors: [ran("mutation", IDS)],
        run: run({ failures: { crap: "x" }, ranAt: { crap: NOW - MINUTE } }),
      },
    ];
    const tickSets = [
      {
        describe: true,
        analysis: true,
        ticked: [],
        armed: [] as string[],
        onlyView: false,
        suites: {},
        folds: [],
      },
      {
        describe: false,
        analysis: true,
        ticked: [],
        armed: ["crap"],
        onlyView: false,
        suites: {},
        folds: [],
      },
      {
        describe: true,
        analysis: true,
        ticked: [],
        armed: ["crap", "mutation"],
        onlyView: false,
        suites: {},
        folds: [],
      },
    ];

    for (const { sensors, run: runState, listed } of options) {
      for (const ticks of tickSets) {
        const model = modelOf(
          IDS,
          { sensors, run: runState, ticks },
          listed ?? SENSORS,
        );
        const upToDate = model.action.primary.label === "Up to date";

        expect(upToDate).toBe(model.summary.shape === "current");
      }
    }
  });
});

describe("the button with unregistered sensors and no plan", () => {
  const listed = (name: string, registered: boolean): RowSensor => ({
    name,
    display: name.toUpperCase(),
    title: "",
    runsTests: false,
    scoped: false,
    registered,
  });
  const quiet = { sensors: [] as SensorStatus[] };

  it("shows a disabled Nothing to run, naming the register command, when the only sensors are unregistered", () => {
    const model = modelOf(IDS, quiet, [listed("alpha", false)]);

    expect(model.action.primary).toEqual({
      label: "Nothing to run",
      disabled: true,
    });
    expect(model.summary.shape).toBe("unregistered");
    expect(model.summary.line).toBe(unregisteredMessage("alpha"));
  });

  it("names every unregistered sensor, one message each", () => {
    const model = modelOf(IDS, quiet, [
      listed("alpha", false),
      listed("beta", false),
    ]);

    expect(model.summary.line).toBe(
      `${unregisteredMessage("alpha")} ${unregisteredMessage("beta")}`,
    );
  });

  it("keeps Up to date when a registered sensor is current beside an unregistered one", () => {
    const model = modelOf(IDS, { sensors: [ran("beta", IDS)] }, [
      listed("beta", true),
      listed("alpha", false),
    ]);

    expect(model.action.primary.label).toBe("Up to date");
    expect(model.summary.shape).toBe("current");
  });

  it("keeps Update and Run labels when unregistered sensors are present", () => {
    const model = modelOf(
      IDS,
      {
        sensors: [],
        ticks: {
          describe: false,
          analysis: false,
          ticked: ["beta"],
          armed: [],
          onlyView: false,
          suites: {},
          folds: [],
        },
      },
      [listed("beta", true), listed("alpha", false)],
    );

    expect(model.action.primary.label).toBe("Run BETA");
  });

  it("reads Checking, disabled, while no plan answer has arrived", () => {
    const model = modelOf(IDS, { plan: null });

    expect(model.action.primary).toEqual({ label: "Checking", disabled: true });
  });

  it("reads checking on the plan-dependent rows and the headline while no plan answer has arrived", () => {
    const model = modelOf(IDS, { plan: null });
    const states = Object.fromEntries(
      model.rows.map(({ key, state }) => [key, state.kind]),
    );

    expect(states[SENSORS[0].name]).toBe("checking");
    expect(states[DESCRIBE_KEY]).toBe("checking");
    expect(model.summary.shape).toBe("checking");
    expect(model.summary.head).toBe("Checking what is out of date");
  });

  it("reads the row and headline states once the plan answer arrives", () => {
    const model = modelOf(IDS, {});

    expect(model.rows.some(({ state }) => state.kind === "checking")).toBe(
      false,
    );
    expect(model.summary.shape).not.toBe("checking");
  });

  it("reads the stale answer's label, not Checking, for an unsettled plan", () => {
    const planned = plannedInput(IDS, {}, SENSORS);
    const model = wordFreshness(
      {
        ...planned,
        plan: planned.plan ? { ...planned.plan, settled: false } : null,
      },
      SENSORS,
    );

    expect(model.action.primary).toEqual({
      label: "Up to date",
      disabled: true,
    });
  });
});

describe("the never-run notice through core's sensor state", () => {
  const neverRan = (settled: boolean) => {
    const planned = plannedInput(
      IDS,
      {
        sensors: [ran("crap", IDS)],
        ticks: {
          describe: true,
          analysis: true,
          ticked: ["mutation"],
          armed: ["crap", "mutation"],
          onlyView: false,
          suites: {},
          folds: [],
        },
      },
      SENSORS,
    );

    return wordFreshness(
      {
        ...planned,
        plan: planned.plan ? { ...planned.plan, settled } : null,
      },
      SENSORS,
    );
  };

  it("a settled plan saying a ticked scoped plugin has no run raises the notice", () => {
    const model = neverRan(true);

    expect(kindOf(model, "mutation")).toBe("never-run");
    expect(freshnessMessage(model)).toMatchObject({
      text: "Mutation has not run here yet. Its results are missing from this picture.",
      label: "Run Mutation",
    });
  });

  it("a plan that has not settled raises nothing, and an unscoped plugin never raises it", () => {
    expect(kindOf(neverRan(false), "mutation")).toBe("checking");
    expect(freshnessMessage(neverRan(false))).toBeNull();
    expect(
      freshnessMessage(
        wordFreshness(
          plannedInput(IDS, { sensors: [ran("mutation", IDS)] }, SENSORS),
          SENSORS,
        ),
      ),
    ).toBeNull();
  });
});

describe("the Findings panel action", () => {
  it("reads Open Scan beside an unticked out-of-date row", () => {
    const ids = ["a.py", "b.py"];
    const model = modelOf(ids, {
      sensors: [
        ran("crap", ids),
        ran("mutation", ids, Object.fromEntries(ids.map((id) => [id, "old"]))),
      ],
      ticks: {
        describe: true,
        analysis: true,
        ticked: [],
        armed: ["crap"],
        onlyView: false,
        suites: {},
        folds: [],
      },
    });

    expect(model.action.primary.disabled).toBe(true);
    expect(findingsActionOf(model.action.primary, "Update them")).toEqual({
      label: "Open Scan",
      openScan: true,
    });
  });

  it("keeps the link when the primary runs ticked work", () => {
    expect(
      findingsActionOf(
        { label: "Update 3 files", disabled: false },
        "Update them",
      ),
    ).toEqual({ label: "Update them", openScan: false });
  });
});

describe("the Nothing ticked to run state", () => {
  const MUTATION_ONLY = {
    describe: true,
    analysis: true,
    ticked: [],
    armed: ["crap"],
    onlyView: false,
    suites: {},
    folds: [],
  };

  it("gives a disabled primary with no tick list for a failed unticked Mutation with everything else current (issue 517)", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS)],
      ticks: MUTATION_ONLY,
      run: run({
        failures: { mutation: "boom" },
        ranAt: { mutation: NOW - MINUTE },
      }),
    });

    expect(model.action.primary).toEqual({
      label: "Nothing ticked to run",
      disabled: true,
    });
  });

  it("gives the same for every optional row unticked and out of date (issue 514)", () => {
    const model = modelOf(IDS, {
      sensors: [
        ran("crap", IDS, { "a.py": "old" }),
        ran("mutation", IDS, { "b.py": "old" }),
      ],
      ticks: {
        describe: false,
        analysis: true,
        ticked: [],
        armed: [],
        onlyView: false,
        suites: {},
        folds: [],
      },
    });

    expect(model.action.primary).toEqual({
      label: "Nothing ticked to run",
      disabled: true,
    });
  });

  it("keeps each other primary label", () => {
    const current = [ran("crap", IDS), ran("mutation", IDS)];
    const running = modelOf(IDS, { sensors: current, scanning: true });
    const rescan = modelOf(IDS, { sensors: current, mode: "rescan" });
    const update = modelOf(IDS, {
      sensors: [ran("crap", IDS, { "a.py": "old" }), ran("mutation", IDS)],
    });
    const run1 = modelOf(IDS, { sensors: [ran("crap", IDS)] });
    const upToDate = modelOf(IDS, { sensors: current });

    expect(running.action.primary.label).toBe("Running");
    expect(rescan.action.primary.label).toBe("Rescan 3 files");
    expect(update.action.primary.label).toBe("Update 1 file");
    expect(run1.action.primary.label).toBe("Run Mutation");
    expect(upToDate.action.primary.label).toBe("Up to date");
  });

  it("follows the mode input and disables it only while scanning", () => {
    const sensors = [ran("crap", IDS), ran("mutation", IDS)];

    expect(modelOf(IDS, { sensors }).action.mode).toEqual({
      value: "bring",
      disabled: false,
    });
    expect(modelOf(IDS, { sensors, mode: "rescan" }).action.mode).toEqual({
      value: "rescan",
      disabled: false,
    });
    expect(modelOf(IDS, { sensors, scanning: true }).action.mode.disabled).toBe(
      true,
    );
  });
});

describe("freshness around a run in the snapshot", () => {
  const snapshotRun = (state: CoreRunState, crap: PluginRunState): RunView => ({
    id: "r1",
    startedBy: "app",
    startedAt: "2026-11-24T00:00:00.000Z",
    scope: { kind: "working-tree" },
    sensors: ["crap"],
    describe: false,
    suites: {},
    state,
    endedAt: null,
    exit: null,
    gaps: [],
    failure: null,
    ran: null,
    plugins: [
      {
        name: "crap",
        phase: "sense",
        state: crap,
        progress: null,
        stage: null,
        estimateMs: null,
        failure: null,
        tally: null,
      },
    ],
    confirmation: null,
    describeHalt: null,
    structure: null,
    log: null,
  });
  const view = (state: CoreRunState, crap: PluginRunState) => ({
    run: snapshotRun(state, crap),
    progress: {} as never,
    starting: null,
    adoptedAtOpen: null,
  });
  const behind = { crap: ran("crap", IDS, { "a.py": "old", "b.py": "old" }) };

  it("never reads out of date for a sensor running in this run", () => {
    const model = modelOf(IDS, {
      sensors: [behind.crap, ran("mutation", IDS)],
      scanning: true,
      run: run({ running: ["crap"], started: "crap" }),
      runView: view("running", "running"),
    });

    expect(kindOf(model, "crap")).toBe("running");
  });

  it("never reads out of date for a sensor that finished in this run before its result lands", () => {
    const model = modelOf(IDS, {
      sensors: [behind.crap, ran("mutation", IDS)],
      scanning: true,
      run: run({ running: [], started: null }),
      runView: view("running", "finished"),
    });

    expect(kindOf(model, "crap")).toBe("current");
  });

  it("reads out of date again once the run has ended and the result is still behind", () => {
    const model = modelOf(IDS, {
      sensors: [behind.crap, ran("mutation", IDS)],
      runView: view("finished", "finished"),
    });

    expect(kindOf(model, "crap")).toBe("out-of-date");
  });
});
