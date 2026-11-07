import { readFileSync } from "node:fs";
import { buildFreshness, type Scan } from "recognizer";
import { describe, expect, it } from "vitest";
import type { FileChange, ScanState } from "./footer-scan";
import {
  buildFreshnessModel,
  type FreshnessModel,
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
): PanelInput["sensors"][number] {
  return {
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
  it("leaves a never-run row out of changed and counts a ticked out-of-date row", () => {
    const model = modelOf(IDS, {
      sensors: [ran("crap", IDS, { "c.py": "old" })],
    });

    expect(kindOf(model, "mutation")).toBe("never-run");
    expect(model.changed).toEqual(["c.py"]);
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
    expect(model.changed).toEqual(["a.py", "c.py"]);
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
