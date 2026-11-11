import { readFileSync } from "node:fs";
import { buildFreshness, type Scan } from "recognizer";
import { describe, expect, it } from "vitest";
import type { FileChange, ScanState } from "./footer-scan";
import {
  buildFreshnessModel,
  type FreshnessModel,
  findingsActionOf,
  type ResultState,
  stateText,
} from "./freshness-model";
import {
  NO_RUN,
  type PanelInput,
  type RowSensor,
  type RunState,
} from "./scan-panel-model";

const MINUTE = 60000;
const NOW = 100 * MINUTE;

const SENSORS: RowSensor[] = [
  { name: "crap", display: "C.R.A.P.", title: "", runsTests: true },
  { name: "mutation", display: "Mutation", title: "", runsTests: true },
];

function scanOf(ids: string[]): Scan {
  return {
    modules: ids.map((id) => ({
      id,
      kind: "module",
      members: [{ name: "f", exported: true, kind: "function" }],
    })),
    edges: [],
    foreign: [],
    files: ids.map((path) => ({ path, hash: `h-${path}` })),
  } as unknown as Scan;
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
  excluded?: { functions: number; modules: string[] },
): PanelInput["sensors"][number] {
  return {
    ...(excluded !== undefined ? { excluded } : {}),
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

function modelOf(
  ids: string[],
  over: Partial<PanelInput> = {},
  sensors: RowSensor[] = SENSORS,
): FreshnessModel {
  const scan = scanOf(ids);
  const input: PanelInput = {
    scan: scanState(),
    config: null,
    sensors: [ran("crap", ids), ran("mutation", ids)],
    lines: { modules: ids, of: () => ({ kind: "current", line: "x" }) },
    describedAt: NOW - 16 * MINUTE,
    ticks: {
      describe: true,
      ticked: [],
      once: ["crap", "mutation"],
      onlyView: false,
    },
    run: NO_RUN,
    scanning: false,
    now: NOW,
    shipped: null,
    scans: [scan],
    freshness: buildFreshness([scan], "t"),
    ...over,
  };

  return buildFreshnessModel(input, sensors);
}

const run = (over: Partial<RunState>): RunState => ({ ...NO_RUN, ...over });
const kindOf = (model: FreshnessModel, key: string) =>
  model.rows.find((row) => row.key === key)?.state.kind;
const IDS = ["a.py", "b.py", "c.py"];

describe("freshness model states", () => {
  it("reads every row current when nothing changed", () => {
    const model = modelOf(IDS);

    expect(model.rows.map((row) => [row.key, row.state.kind])).toEqual([
      ["structure", "current"],
      ["describe", "current"],
      ["crap", "current"],
      ["mutation", "current"],
    ]);
    expect(model.rows[0]?.tickable).toBe(false);
  });

  it("reads a row out of date with the modules whose hash moved", () => {
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
      sensorProgress: { name: "mutation", step: "mutants", done: 5, total: 9 },
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

  it("reads Structure out of date from changed files that are modules, ignoring one that is not", () => {
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

  it("reads Structure out of date for every in-scope module when the commit moved", () => {
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
      "1 module out of date",
    );
    expect(text({ kind: "out-of-date", modules: ["a", "b"] })).toEqual({
      icon: "circle-alert",
      text: "2 modules out of date",
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

describe("freshness model changed modules", () => {
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
        ticked: [],
        once: ["mutation"],
        onlyView: false,
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

describe("freshness model sensor gaps and excluded modules", () => {
  const MUTATION_NO_RESULT = "Mutation has no result for";

  it("reads a sensor-only gap as behind, not changed, and offers the update", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS, { "c.py": "old" }), ran("mutation", IDS)],
    });

    expect(model.changed).toEqual([]);
    expect(model.update).toEqual(["c.py"]);
    expect(model.summary.shape).toBe("behind");
    expect(model.summary.head).not.toContain("changed since");
    expect(model.action.primary.label).toBe("Update 1 module");
  });

  it("says changed only of Structure's modules and updates both", () => {
    const model = modelOf(IDS, {
      scan: scanState([{ path: "a.py", kind: "modified" }]),
      sensors: [ran("crap", IDS, { "c.py": "old" }), ran("mutation", IDS)],
    });

    expect(model.summary.head).toBe("1 module changed since it was scanned");
    expect(model.action.primary.label).toBe("Update 2 modules");
  });

  it("settles a fully excluded module and names it with the reason", () => {
    const model = modelOf(IDS, {
      sensors: [
        ran("crap", IDS),
        ran("mutation", IDS, {}, { functions: 2, modules: ["a.py"] }),
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

  it("names only the excluded modules in scope and not in the gap", () => {
    const model = modelOf(IDS, {
      sensors: [
        ran("crap", IDS),
        ran(
          "mutation",
          IDS,
          { "c.py": "old" },
          { functions: 3, modules: ["a.py", "gone.py", "c.py"] },
        ),
      ],
    });

    expect(model.noResult).toEqual([{ sensor: "Mutation", modules: ["a.py"] }]);
    expect(model.update).toEqual(["c.py"]);
    expect(model.summary.line).toContain(`${MUTATION_NO_RESULT} a.py:`);
    expect(model.summary.line).not.toContain("c.py:");
  });

  it("uses the plural sentence for two excluded modules", () => {
    const model = modelOf(IDS, {
      sensors: [
        ran("crap", IDS),
        ran("mutation", IDS, {}, { functions: 2, modules: ["a.py", "b.py"] }),
      ],
    });

    expect(model.summary.line).toContain(
      "Mutation has no result for a.py and b.py: their suites' coverage reports do not include them.",
    );
  });

  it("says nothing about excluded modules when the sensor never ran", () => {
    const model = modelOf(IDS, { sensors: [ran("crap", IDS)] });

    expect(kindOf(model, "mutation")).toBe("never-run");
    expect(model.noResult).toEqual([]);
    expect(model.summary.line).not.toContain("has no result");
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

  it("9 changed: Update 9 modules with the names and no bar", () => {
    const model = modelOf(nine, { scan: scanState(changedNine) });

    expect(model.action.primary).toEqual({
      label: "Update 9 modules",
      disabled: false,
    });
    expect(model.summary).toMatchObject({
      shape: "changed",
      head: "9 modules changed since they were scanned",
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
        step: "mutants",
        done: 251,
        total: 1204,
      },
    });

    expect(model.summary.shape).toBe("running");
    expect(model.summary.head).toBe("Running Mutation on 9 modules");
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
      "Their values and findings are missing. Structure and Descriptions are current.",
    );
    expect(model.action.primary.label).toBe("Run C.R.A.P. and Mutation");
    expect(model.summary.bar).toBeNull();
  });

  it("counts only the canvas modules for a canvas scope", () => {
    const model = modelOf(nine, {
      view: { name: "x", modules: nine.slice(0, 2) },
      ticks: { describe: true, ticked: [], once: [], onlyView: true },
      sensors: [],
    });

    expect(model.scopeCount).toBe(2);
  });
});

describe("the running summary without a changed module", () => {
  it("names the in-scope count, never 0, when only a never-run sensor runs", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS)],
      scanning: true,
      run: run({ running: ["mutation"], started: "mutation" }),
    });

    expect(model.summary.head).toBe("Running Mutation on 3 modules");
    expect(model.summary.head).not.toContain(" 0 ");
  });

  it("says 1 module on the boundary", () => {
    const model = modelOf(IDS, {
      scanning: true,
      runModules: 1,
      run: run({ running: ["mutation"], started: "mutation" }),
    });

    expect(model.summary.head).toBe("Running Mutation on 1 module");
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

  it("names the hidden changed modules before any missing sensor", () => {
    const model = modelOf(IDS, {
      scan: scanState([{ path: "a.py", kind: "modified" }]),
      sensors: [ran("crap", IDS)],
    });

    expect(model.findings).toEqual({
      kind: "hidden",
      text: "Findings for 1 changed module is hidden.",
      link: "Update them",
    });
  });
});

describe("the unscoped stale set per sensor", () => {
  const sorted = (set: ReadonlySet<string> | undefined) => [...(set ?? [])];

  it("holds the same stale modules in every row state", () => {
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

  it("covers modules outside the view when only this view is on", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS, { "c.py": "old" }), ran("mutation", IDS)],
      ticks: {
        describe: true,
        ticked: [],
        once: ["crap", "mutation"],
        onlyView: true,
      },
      view: { name: "v", modules: ["a.py"] } as never,
    });

    expect(kindOf(model, "crap")).toBe("current");
    expect(sorted(model.stale.get("crap"))).toEqual(["c.py"]);
    expect([...model.modules]).toEqual(IDS);
  });

  it("holds every module when the measurement is not valid", () => {
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

  it("keeps a module stale under one sensor out of the other's set", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS, { "a.py": "old" }), ran("mutation", IDS)],
    });

    expect(sorted(model.stale.get("crap"))).toEqual(["a.py"]);
    expect(sorted(model.stale.get("mutation"))).toEqual([]);
  });
});

describe("the model's imports", () => {
  it("takes no port, source or rescanner", () => {
    const source = readFileSync(
      new URL("./freshness-model.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(
      /from "\.\/(rescanner|[a-z-]+-source|[a-z-]+-port)"/,
    );
  });
});

describe("the model over committed content", () => {
  it("names exactly the two changed modules, in scope order", () => {
    const scan = JSON.parse(
      readFileSync(
        new URL("../../fixtures/python/expected-scan.json", import.meta.url),
        "utf8",
      ),
    ) as Scan;
    const ids = scan.modules.map(({ id }) => id);
    const model = modelOf(ids, {
      scans: [scan],
      freshness: buildFreshness([scan], "t"),
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
    ticked: [],
    once: ["crap"],
    onlyView: false,
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
    expect(model.summary.head).toBe("Mutation is out of date on 42 modules");
    expect(model.changed).toEqual([]);
    expect(model.action.primary).toEqual({
      label: "Nothing ticked to run",
      disabled: true,
    });
  });

  it("reads one module in the singular, and Update 1 module once ticked", () => {
    const sensors = [ran("crap", IDS), ran("mutation", IDS, { "a.py": "old" })];
    const unticked = modelOf(IDS, { sensors, ticks: MUTATION_ONLY });
    const ticked = modelOf(IDS, { sensors });

    expect(unticked.summary.head).toBe("Mutation is out of date on 1 module");
    expect(ticked.action.primary.label).toBe("Update 1 module");
  });

  it("reads two unticked out-of-date rows as nothing to run", () => {
    const model = modelOf(IDS, {
      sensors: [
        ran("crap", IDS, { "a.py": "old" }),
        ran("mutation", IDS, { "b.py": "old" }),
      ],
      ticks: { describe: true, ticked: [], once: [], onlyView: false },
    });

    expect(model.summary.head).toBe(
      "C.R.A.P. is out of date on 1 module; Mutation is out of date on 1 module",
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
    expect(model.action.primary.label).toBe("Update 1 module");
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

    expect(model.action.primary.label).toBe("Rescan 3 modules");
  });

  it("never shows Up to date beside a non-current headline, across every combination", () => {
    const options = [
      { sensors: [ran("crap", IDS), ran("mutation", IDS)], run: NO_RUN },
      {
        sensors: [ran("crap", IDS, { "a.py": "old" }), ran("mutation", IDS)],
        run: NO_RUN,
      },
      { sensors: [ran("mutation", IDS)], run: NO_RUN },
      {
        sensors: [ran("mutation", IDS)],
        run: run({ failures: { crap: "x" }, ranAt: { crap: NOW - MINUTE } }),
      },
    ];
    const tickSets = [
      { describe: true, ticked: [], once: [] as string[], onlyView: false },
      { describe: false, ticked: [], once: ["crap"], onlyView: false },
      {
        describe: true,
        ticked: [],
        once: ["crap", "mutation"],
        onlyView: false,
      },
    ];

    for (const { sensors, run: runState } of options) {
      for (const ticks of tickSets) {
        const model = modelOf(IDS, { sensors, run: runState, ticks });
        const upToDate = model.action.primary.label === "Up to date";

        expect(upToDate).toBe(model.summary.shape === "current");
      }
    }
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
      ticks: { describe: true, ticked: [], once: ["crap"], onlyView: false },
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
        { label: "Update 3 modules", disabled: false },
        "Update them",
      ),
    ).toEqual({ label: "Update them", openScan: false });
  });
});

describe("the Nothing ticked to run state", () => {
  const MUTATION_ONLY = {
    describe: true,
    ticked: [],
    once: ["crap"],
    onlyView: false,
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
      ticks: { describe: false, ticked: [], once: [], onlyView: false },
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
    expect(rescan.action.primary.label).toBe("Rescan 3 modules");
    expect(update.action.primary.label).toBe("Update 1 module");
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
