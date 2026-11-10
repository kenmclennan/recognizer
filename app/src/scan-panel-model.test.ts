import type { Diagnosis, Scan } from "recognizer";
import { buildFreshness } from "recognizer";
import { describe, expect, it } from "vitest";
import type { ScanState } from "./footer-scan";
import { NO_CHANGES } from "./footer-scan";
import type { ResponsibilityState } from "./responsibility-model";
import {
  functionCount,
  NO_RUN,
  type PanelInput,
  phasesFor,
  type RunState,
  rowSensors,
  scanPanel,
} from "./scan-panel-model";
import { whyOf } from "./scan-why";
import type { ShippedSensor, ShippedSensors } from "./sensor-run";

const CONFIG = `sensors:
  alpha:
    command: [node, "{repository}/a.mjs", "{commit}", "{output}"]
  duplication: {}
  beta:
    command: [node, "{repository}/b.mjs", "{commit}", "{output}"]
`;

const MINUTE = 60000;
const NOW = 100 * MINUTE;

const SCAN: ScanState = {
  origin: { branch: "main", commit: "abc1234" },
  scannedAt: NOW - 27 * MINUTE,
  changes: NO_CHANGES,
  scanning: null,
};

function shipped(
  name: string,
  display: string,
  over: Partial<ShippedSensor> = {},
): ShippedSensor {
  return {
    name,
    display,
    line: `${display} does its thing.`,
    defaults: {},
    runsTests: false,
    listed: true,
    ...over,
  };
}

const LIST: ShippedSensors = {
  status: "ok",
  sensors: [
    shipped("mutation", "Mutation", { runsTests: true }),
    shipped("crap", "C.R.A.P.", { runsTests: true }),
    shipped("thresholds", "Thresholds", { listed: false }),
    shipped("duplication", "Duplication"),
  ],
};

const CURRENT: Record<string, ResponsibilityState> = {
  "a.py": { kind: "current", line: "x" },
  "b.py": { kind: "current", line: "y" },
  "c.py": { kind: "missing" },
};

function allCurrent(modules: string[]): PanelInput["lines"] {
  return { modules, of: () => ({ kind: "current", line: "x" }) };
}

function input(over: Partial<PanelInput> = {}): PanelInput {
  return {
    scan: SCAN,
    config: CONFIG,
    sensors: [],
    lines: {
      modules: Object.keys(CURRENT),
      of: (id) => CURRENT[id] as ResponsibilityState,
    },
    describedAt: null,
    ticks: { describe: false, ticked: [], once: [], onlyView: false },
    run: NO_RUN,
    scanning: false,
    now: NOW,
    shipped: LIST,
    ...over,
  };
}

function run(over: Partial<RunState>): RunState {
  return { ...NO_RUN, ...over };
}

const states = (model: ReturnType<typeof scanPanel>) =>
  model.rows.map((row) => `${row.name}: ${row.text.text}`);

const fresh = input({
  scan: null,
  lines: { modules: ["a.py"], of: () => ({ kind: "missing" }) },
});

describe("scanPanel rows", () => {
  it("lists Structure, Descriptions, shipped sensors by display name, then third-party sensors in config order", () => {
    expect(scanPanel(input()).rows.map((row) => row.name)).toEqual([
      "Structure",
      "Descriptions",
      "C.R.A.P.",
      "Duplication",
      "Mutation",
      "alpha",
      "beta",
    ]);
  });

  it("omits a shipped sensor that is not listed and makes only Structure untickable", () => {
    const rows = scanPanel(input()).rows;

    expect(rows.map((row) => row.key)).not.toContain("thresholds");
    expect(rows.filter((row) => !row.tickable).map((row) => row.key)).toEqual([
      "structure",
    ]);
  });

  it("keeps Structure ticked and disabled, and disables every other row only while scanning", () => {
    const idle = scanPanel(input()).rows;
    const busy = scanPanel(input({ scanning: true })).rows;

    expect(idle.find((row) => row.key === "structure")).toMatchObject({
      ticked: true,
      disabled: true,
      title: "Structure always runs",
    });
    expect(idle.filter((row) => row.disabled).map((row) => row.key)).toEqual([
      "structure",
    ]);
    expect(busy.every((row) => row.disabled)).toBe(true);
  });

  it("titles a shipped row with the registry's sentence and Descriptions with the mock's wording", () => {
    const rows = scanPanel(input()).rows;

    expect(rows.find((row) => row.key === "describe")?.title).toBe(
      "Writes one line per module saying what it is responsible for.",
    );
    expect(rows.find((row) => row.key === "crap")?.title).toBe(
      "C.R.A.P.: Change Risk Anti-Patterns. C.R.A.P. does its thing.",
    );
  });

  it("shows Structure, Descriptions and third-party rows only when the shipped list is unavailable", () => {
    const model = scanPanel(
      input({ shipped: { status: "unavailable", reason: "old" } }),
    );

    expect(model.rows.map((row) => row.name)).toEqual([
      "Structure",
      "Descriptions",
      "alpha",
      "beta",
    ]);
  });

  it("is pending with no rows, reports or Scan button content while the shipped list is unread", () => {
    const model = scanPanel(input({ shipped: null }));

    expect(model.pending).toBe(true);
    expect(model.rows).toEqual([]);
    expect(model.reports).toEqual([]);
    expect(scanPanel(input()).pending).toBe(false);
  });

  it("does not list a shipped sensor a repository also registers as third-party", () => {
    expect(
      rowSensors(CONFIG, LIST).filter((one) => one.name === "duplication"),
    ).toHaveLength(1);
  });
});

describe("scanPanel while another process scans", () => {
  const external = () =>
    scanPanel(
      input({
        scanning: true,
        external: true,
        view: { name: "v", modules: ["a.py"] },
        run: run({ running: ["crap"], started: "crap" }),
      }),
    );

  it("disables the rows, both toggles and the primary button", () => {
    const model = external();

    expect(model.rows.every((row) => row.disabled)).toBe(true);
    expect(model.scope?.disabled).toBe(true);
    expect(model.freshness.action.mode.disabled).toBe(true);
    expect(model.button).toMatchObject({ label: "Running", disabled: true });
  });

  it("offers no Stop because the scan is not this window's", () => {
    expect(external().button.scanning).toBe(false);
    expect(
      scanPanel(input({ scanning: true, run: run({ running: ["crap"] }) }))
        .button.scanning,
    ).toBe(true);
  });
});

describe("scanPanel header", () => {
  it("reads Not scanned yet without a scan", () => {
    expect(scanPanel(fresh).header).toEqual({
      text: "Not scanned yet",
      moved: null,
    });
  });

  it("reads Ran with an age and no sha", () => {
    expect(scanPanel(input()).header).toEqual({
      text: "Ran 27 minutes ago",
      moved: null,
    });
  });

  it("carries no amber phrase for changed files, and the moved text when the commit moved", () => {
    const files = scanPanel(
      input({
        scan: {
          ...SCAN,
          changes: { files: [{ path: "a.py", kind: "modified" }], moved: null },
        },
      }),
    );
    const moved = scanPanel(
      input({
        scan: {
          ...SCAN,
          changes: { files: [], moved: { branch: "main", commit: "9f8e7d6" } },
        },
      }),
    );
    const detached = scanPanel(
      input({
        scan: {
          ...SCAN,
          changes: { files: [], moved: { branch: null, commit: "9f8e7d6" } },
        },
      }),
    );

    expect(files.header.moved).toBeNull();
    expect(moved.header.moved).toBe("Now on main at 9f8e7d6");
    expect(detached.header.moved).toBe("Now at 9f8e7d6");
  });

  it("reads Scanning… while a scan runs with no progress text", () => {
    expect(scanPanel(input({ scanning: true })).header.text).toBe("Scanning…");
  });

  it("shows the progress text while a scan runs", () => {
    expect(
      scanPanel(
        input({
          scanning: true,
          progressText: "Running C.R.A.P.\u2026 2 of 3",
        }),
      ).header.text,
    ).toBe("Running C.R.A.P.\u2026 2 of 3");
  });
});

describe("scanPanel row states", () => {
  const rowOf = (model: ReturnType<typeof scanPanel>, key: string) =>
    model.rows.find((row) => row.key === key);

  it("reads never run on a repository nothing has run on, and Structure as never run without a scan", () => {
    expect(states(scanPanel(fresh))).toEqual([
      "Structure: never run",
      "Descriptions: never run",
      "C.R.A.P.: never run",
      "Duplication: never run",
      "Mutation: never run",
      "alpha: never run",
      "beta: never run",
    ]);
  });

  it("reads Descriptions current with the age from the responsibilities file", () => {
    const model = scanPanel(
      input({
        describedAt: NOW - 2 * 24 * 60 * MINUTE,
        lines: allCurrent(["a.py", "b.py"]),
      }),
    );

    expect(rowOf(model, "describe")).toMatchObject({
      state: { kind: "current", at: NOW - 2 * 24 * 60 * MINUTE },
      text: { text: "current, 2 days ago" },
    });
  });

  it("drops the age when none is known", () => {
    const model = scanPanel(input({ lines: allCurrent(["a.py"]) }));

    expect(rowOf(model, "describe")?.text.text).toBe("current");
  });

  it("reads Descriptions out of date for every out-of-date or missing module once one has a line", () => {
    const modules = Array.from({ length: 40 }, (_, at) => `m${at}.py`);
    const model = scanPanel(
      input({
        lines: {
          modules,
          of: (id) =>
            id === "m0.py"
              ? { kind: "out-of-date", line: "x", reasons: ["source"] }
              : id === "m1.py"
                ? { kind: "current", line: "x" }
                : { kind: "missing" },
        },
      }),
    );

    expect(rowOf(model, "describe")?.text.text).toBe("39 modules out of date");
  });

  it("reads the finished of total count for Descriptions while it runs", () => {
    const model = scanPanel(
      input({
        scanning: true,
        run: run({ running: ["describe"], started: "describe" }),
        describeProgress: { entries: 12, total: 40 },
      }),
    );

    expect(rowOf(model, "describe")?.state).toEqual({
      kind: "running",
      done: 12,
      total: 40,
    });
    expect(rowOf(model, "describe")?.text.text).toBe("12 of 40");
  });

  it("reads Mutation running with its mutant count and Structure running while extracting", () => {
    const model = scanPanel(
      input({
        scanning: true,
        extracting: true,
        run: run({ running: ["mutation"], started: "mutation" }),
        sensorProgress: {
          name: "mutation",
          step: "mutants",
          done: 251,
          total: 1204,
        },
      }),
    );

    expect(rowOf(model, "mutation")?.text.text).toBe("251 of 1,204");
    expect(rowOf(model, "structure")?.state.kind).toBe("running");
  });

  it.each([
    [
      "limit",
      "Stopped: Claude usage limit reached: out of quota. 412 described, 1,628 not described. The next scan describes the rest.",
    ],
    [
      "failures",
      "Stopped: 4 describing calls failed in a row. 412 described, 1,628 not described. The next scan describes the rest.",
    ],
  ] as const)(
    "keeps the describe stop sentence for %s in the note",
    (cause, note) => {
      const model = scanPanel(
        input({
          describeStop: {
            cause,
            reason: "out of quota",
            described: 412,
            notDescribed: 1628,
            threshold: 4,
          },
        }),
      );

      expect(rowOf(model, "describe")?.note).toBe(note);
    },
  );

  it("keeps skipped this scan in the note after a skip answer", () => {
    const model = scanPanel(input({ describeSkipped: true }));

    expect(rowOf(model, "describe")?.note).toBe("skipped this scan");
  });

  it("carries the confirmation card text only while a question is open", () => {
    const asked = scanPanel(
      input({
        describeAsk: {
          modules: 2040,
          model: "sonnet",
          inputTokens: 8_000_000,
          costUsd: 17.54,
        },
      }),
    );

    expect(asked.confirm).toEqual({
      heading: "Describe 2,040 modules?",
      model: "Model: sonnet",
      estimate: "About 8.0M tokens, $17.54 at API prices",
    });
    expect(scanPanel(input({})).confirm).toBeNull();
  });

  it("reads a ran sensor current with the age from the findings file", () => {
    const model = scanPanel(
      input({
        sensors: [
          {
            name: "crap",
            status: "ran",
            findings: 16,
            modifiedMs: NOW - 27 * MINUTE,
          },
          { name: "duplication", status: "ran", findings: 1, modifiedMs: NOW },
        ],
      }),
    );

    expect(states(model)).toContain("C.R.A.P.: current, 27 minutes ago");
    expect(states(model)).toContain("Duplication: current, just now");
  });

  it("prefers the session time over the file's modification time", () => {
    const model = scanPanel(
      input({
        sensors: [
          {
            name: "alpha",
            status: "ran",
            findings: 2,
            modifiedMs: NOW - 60 * MINUTE,
          },
        ],
        run: run({ ranAt: { alpha: NOW - 2 * MINUTE } }),
      }),
    );

    expect(states(model)).toContain("alpha: current, 2 minutes ago");
  });

  it.each([
    { measured: 0, total: 5, note: "stopped, nothing measured" },
    { measured: 2, total: 5, note: "stopped, 2 of 5 functions measured" },
    { measured: 5, total: 5, note: "stopped, 5 of 5 functions measured" },
  ])(
    "reads a stopped document of $measured of $total as current and keeps the diagnosis in the note",
    ({ measured, total, note }) => {
      for (const status of ["ran", "stale"] as const) {
        const model = scanPanel(
          input({
            sensors: [
              {
                name: "mutation",
                status,
                findings: 0,
                modifiedMs: NOW - 3 * MINUTE,
                stopped: { measured, total },
              },
            ],
          }),
        );

        expect(rowOf(model, "mutation")?.state.kind).toBe("current");
        expect(rowOf(model, "mutation")?.note).toBe(note);
      }
    },
  );

  it("reads failed with the age from the held failure", () => {
    const model = scanPanel(
      input({
        run: run({ failures: { crap: "boom" }, ranAt: { crap: NOW } }),
      }),
    );

    expect(rowOf(model, "crap")?.state).toEqual({ kind: "failed", at: NOW });
    expect(rowOf(model, "crap")?.text.text).toBe("failed, just now");
  });

  it("reads failed with no age for a findings file that could not be read", () => {
    const model = scanPanel(
      input({
        sensors: [
          { name: "alpha", status: "failed", reason: "could not be read" },
        ],
      }),
    );

    expect(rowOf(model, "alpha")?.state).toEqual({ kind: "failed", at: null });
    expect(rowOf(model, "alpha")?.text.text).toBe("failed");
  });

  it("reads every planned row running during a scan and leaves the others as they were", () => {
    const model = scanPanel(
      input({
        scanning: true,
        run: run({ running: ["crap", "duplication"], started: "crap" }),
      }),
    );

    expect(rowOf(model, "crap")?.state.kind).toBe("running");
    expect(rowOf(model, "duplication")?.state.kind).toBe("running");
    expect(rowOf(model, "mutation")?.text.text).toBe("never run");
  });

  it("falls through to current for a planned row that finished in this scan", () => {
    const model = scanPanel(
      input({
        scanning: true,
        sensors: [
          { name: "crap", status: "ran", findings: 4, modifiedMs: NOW },
        ],
        run: run({
          running: ["duplication"],
          started: "duplication",
          ranAt: { crap: NOW },
        }),
      }),
    );

    expect(rowOf(model, "crap")?.text.text).toBe("current, just now");
  });

  it("offers Run Structure on a repository never scanned, and a disabled Running button during a scan", () => {
    expect(scanPanel(fresh).button).toEqual({
      scanning: false,
      label: "Run Structure",
      disabled: false,
    });
    expect(scanPanel(input({ scanning: true })).button).toEqual({
      scanning: true,
      label: "Running",
      disabled: true,
    });
  });
});

describe("scanPanel ticks", () => {
  it("shows nothing ticked on a fresh repository", () => {
    expect(
      scanPanel(fresh)
        .rows.filter((row) => row.ticked)
        .map((row) => row.key),
    ).toEqual(["structure"]);
  });

  it("ticks a plain sensor from the stored names and a tests-running one from once", () => {
    const model = scanPanel(
      input({
        ticks: {
          describe: true,
          ticked: ["duplication"],
          once: ["crap"],
          onlyView: false,
        },
      }),
    );
    const ticked = model.rows.filter((row) => row.ticked).map((row) => row.key);

    expect(ticked).toEqual(["structure", "describe", "crap", "duplication"]);
  });

  it("ticks every plain sensor but no tests-running one when never stored and defaulting on", () => {
    const model = scanPanel(
      input({
        ticks: { describe: false, ticked: null, once: [], onlyView: false },
      }),
    );

    expect(
      model.rows.filter((row) => row.ticked).map((row) => row.key),
    ).toEqual(["structure", "duplication", "alpha", "beta"]);
  });

  it("ticks nothing when a fresh repository defaults to no sensors", () => {
    const model = scanPanel(
      input({
        ticks: { describe: false, ticked: [], once: [], onlyView: false },
      }),
    );

    expect(
      model.rows.filter((row) => row.ticked).map((row) => row.key),
    ).toEqual(["structure"]);
  });
});

describe("phasesFor", () => {
  const rows = [
    { name: "crap", runsTests: true },
    { name: "duplication", runsTests: false },
    { name: "alpha", runsTests: false },
  ];

  it("plans a shipped, a registered and reports an unknown sensor as dropped", () => {
    const { plan, dropped } = phasesFor(
      {
        describe: true,
        ticked: ["duplication", "alpha", "ghost"],
        once: [],
        onlyView: false,
      },
      rows,
    );

    expect(plan).toEqual({
      describe: true,
      describeAll: false,
      sense: ["duplication", "alpha"],
      modules: null,
    });
    expect(dropped).toEqual(["ghost"]);
  });

  it("adds a tests-running sensor only when it is in once", () => {
    expect(
      phasesFor(
        { describe: false, ticked: [], once: ["crap"], onlyView: false },
        rows,
      ).plan.sense,
    ).toEqual(["crap"]);
    expect(
      phasesFor(
        { describe: false, ticked: ["crap"], once: [], onlyView: false },
        rows,
      ).plan.sense,
    ).toEqual([]);
  });

  it("runs every plain sensor when never stored", () => {
    expect(
      phasesFor(
        { describe: false, ticked: null, once: [], onlyView: false },
        rows,
      ).plan.sense,
    ).toEqual(["duplication", "alpha"]);
  });
});

const SCANS: Scan[] = [
  {
    modules: [
      {
        id: "a.py",
        kind: "module",
        members: [
          { name: "f", exported: true, kind: "function" },
          { name: "g", exported: true, kind: "function" },
          { name: "K", exported: true, kind: "constant" },
        ],
      },
      {
        id: "b.py",
        kind: "module",
        members: [
          {
            name: "C",
            exported: true,
            kind: "class",
            methods: [
              { name: "m", visibility: "public", params: [] },
              { name: "n", visibility: "public", params: [] },
            ],
          },
        ],
      },
      { id: "c.py", kind: "module" },
    ],
    edges: [],
    foreign: [],
  } as unknown as Scan,
];

describe("functionCount", () => {
  it("counts function members and the methods of classes, over every module with no scope", () => {
    expect(functionCount(SCANS, null)).toBe(4);
  });

  it("counts only the scoped modules", () => {
    expect(functionCount(SCANS, ["a.py"])).toBe(2);
    expect(functionCount(SCANS, ["b.py", "c.py"])).toBe(2);
    expect(functionCount(SCANS, ["gone.py"])).toBe(0);
  });
});

describe("scanPanel only this view", () => {
  const view = { name: "engine-loop", modules: ["a.py"] };
  const ticked = (onlyView: boolean) => ({
    describe: true,
    ticked: [],
    once: ["mutation"],
    onlyView,
  });
  const row = (model: ReturnType<typeof scanPanel>, key: string) =>
    model.rows.find((one) => one.key === key);

  it("shows the switch for a canvas, captioned with the view's name or This canvas and the module count", () => {
    expect(scanPanel(input()).scope).toBeNull();
    expect(scanPanel(input({ view })).scope).toEqual({
      caption: "engine-loop, 1",
      on: false,
      disabled: false,
      canvasEmpty: false,
    });
    expect(
      scanPanel(input({ view: { name: "v", modules: ["a.py", "b.py"] } })).scope
        ?.caption,
    ).toBe("v, 2");
    expect(
      scanPanel(input({ view: { name: null, modules: ["a.py"] } })).scope
        ?.caption,
    ).toBe("This canvas, 1");
  });

  it("scopes the modules the freshness model counts to the open view when the switch is on", () => {
    const untitled = { name: null, modules: ["a.py"] };
    const on = scanPanel(
      input({ view: untitled, scans: SCANS, ticks: ticked(true) }),
    );
    const off = scanPanel(
      input({ view: untitled, scans: SCANS, ticks: ticked(false) }),
    );

    expect(on.freshness.scopeCount).toBe(1);
    expect(off.freshness.scopeCount).toBe(3);
  });

  it("locks the switch while scanning and reflects the stored value", () => {
    const model = scanPanel(
      input({ view, scanning: true, ticks: ticked(true) }),
    );

    expect(model.scope).toEqual({
      caption: "engine-loop, 1",
      on: true,
      disabled: true,
      canvasEmpty: false,
    });
  });

  it("reads Descriptions from the view's modules with the switch on and from all of them with it off", () => {
    const off = scanPanel(input({ view, ticks: ticked(false) }));
    const on = scanPanel(input({ view, ticks: ticked(true) }));
    const other = scanPanel(
      input({ view: { name: "v", modules: ["c.py"] }, ticks: ticked(true) }),
    );

    expect(row(off, "describe")?.text.text).toBe("1 module out of date");
    expect(row(on, "describe")?.state.kind).toBe("current");
    expect(row(other, "describe")?.state.kind).toBe("never-run");
  });

  it("leaves the other rows alone when the scope changes", () => {
    const off = scanPanel(input({ scans: SCANS, ticks: ticked(false) }));
    const on = scanPanel(input({ view, scans: SCANS, ticks: ticked(true) }));

    expect(row(on, "crap")?.state).toEqual(row(off, "crap")?.state);
    expect(row(on, "duplication")?.state).toEqual(
      row(off, "duplication")?.state,
    );
  });

  it("ignores the stored switch when no view is open", () => {
    const model = scanPanel(input({ scans: SCANS, ticks: ticked(true) }));

    expect(model.freshness.scopeCount).toBe(3);
    expect(model.scope).toBeNull();
  });
});

describe("scanPanel freshness", () => {
  const freshScan = {
    modules: ["a.py", "b.py"].map((id) => ({
      id,
      kind: "module",
      members: [{ name: "f", exported: true, kind: "function" }],
    })),
    edges: [],
    foreign: [],
    files: [
      { path: "a.py", hash: "ha" },
      { path: "b.py", hash: "hb" },
    ],
  } as unknown as Scan;

  const crap = (inputs: Record<string, string>) => ({
    name: "crap",
    status: "ran" as const,
    findings: 0,
    modifiedMs: null,
    measured: { inputs, tests: "t" },
  });

  const others = ["duplication", "mutation", "alpha", "beta"].map((name) => ({
    ...crap({ "a.py": "ha", "b.py": "hb" }),
    name,
  }));

  const base = (inputs: Record<string, string>) =>
    input({
      sensors: [crap(inputs), ...others],
      scans: [freshScan],
      lines: allCurrent(["a.py", "b.py"]),
      ticks: { describe: true, ticked: [], once: ["crap"], onlyView: false },
      freshness: buildFreshness([freshScan], "t"),
    });

  it("keeps the second line of a ran, partly row when a module gap replaces the state", () => {
    const withWhy = base({ "a.py": "ha", "b.py": "old" });
    const model = scanPanel({
      ...withWhy,
      sensors: [
        {
          ...crap({ "a.py": "ha", "b.py": "old" }),
          diagnosis: { code: "tests-failed", line: "3 failed" },
        },
      ],
    });
    const row = model.rows.find(({ key }) => key === "crap");

    expect(row?.text.text).toBe("1 module out of date");
    expect(row?.why).not.toBeNull();
  });

  it("summarises the changed module and offers Update 1 module", () => {
    const model = scanPanel(base({ "a.py": "ha", "b.py": "old" }));
    const row = model.rows.find(({ key }) => key === "crap");

    expect(model.freshness.summary.head).toBe(
      "1 module changed since it was scanned",
    );
    expect(model.freshness.changed).toEqual(["b.py"]);
    expect(row?.text.text).toBe("1 module out of date");
    expect(model.button).toEqual({
      scanning: false,
      label: "Update 1 module",
      disabled: false,
    });
  });

  it("says everything is current and offers a disabled Up to date when every ticked result is current", () => {
    const model = scanPanel(base({ "a.py": "ha", "b.py": "hb" }));

    expect(model.freshness.summary.head).toBe(
      "Everything on the repository is current",
    );
    expect(model.button).toEqual({
      scanning: false,
      label: "Up to date",
      disabled: true,
    });
  });

  it("reads a sensor with no findings document as never run and offers to run it", () => {
    const model = scanPanel({ ...base({}), sensors: others });

    expect(model.freshness.summary.head).toBe("C.R.A.P. has never run");
    expect(model.rows.find(({ key }) => key === "crap")?.text.text).toBe(
      "never run",
    );
    expect(model.button.label).toBe("Run C.R.A.P.");
  });

  it("scopes the summary to the open view's modules", () => {
    const model = scanPanel({
      ...base({ "a.py": "ha", "b.py": "old" }),
      view: { name: "engine", modules: ["a.py"] },
      ticks: { describe: true, ticked: [], once: ["crap"], onlyView: true },
    });

    expect(model.freshness.summary.head).toBe(
      "Everything on this canvas is current",
    );
  });
});

describe("scanPanel why", () => {
  const FIX = "cargo install cargo-llvm-cov";
  const refusal = (name: string, diagnosis: Diagnosis) =>
    scanPanel(
      input({
        run: run({
          failures: { [name]: "refused" },
          diagnoses: { [name]: diagnosis },
          ranAt: { [name]: NOW },
        }),
      }),
    ).rows.find((row) => row.key === name);
  const completed = (diagnosis: Diagnosis) =>
    scanPanel(
      input({
        sensors: [
          {
            name: "crap",
            status: "ran",
            findings: 2,
            modifiedMs: NOW,
            diagnosis,
          },
        ],
      }),
    ).rows.find((row) => row.key === "crap");

  it("reads failed for a refusal with tool-missing and offers the fix to copy", () => {
    const row = refusal("crap", {
      code: "tool-missing",
      line: `pytest is missing. Add it with ${FIX}`,
      fix: FIX,
    });

    expect(row?.state).toEqual({ kind: "failed", at: NOW });
    expect(row?.why).toEqual({
      segments: [
        { text: "pytest is missing. Add it with ", code: false },
        { text: FIX, code: true },
        { text: ".", code: false },
      ],
      copy: FIX,
      log: false,
    });
  });

  it("reads failed for tests-failed, marks the first failing name and offers the log", () => {
    const row = refusal("mutation", {
      code: "tests-failed",
      line: "Suite fails. Failing: t::a and 2 more",
      failing: { count: 3, names: ["t::a"] },
    });

    expect(row?.state).toEqual({ kind: "failed", at: NOW });
    expect(row?.why?.segments).toContainEqual({ text: "t::a", code: true });
    expect(row?.why).toMatchObject({ copy: null, log: true });
  });

  it("gives coverage-unavailable a refusal with the log only when there is no fix", () => {
    expect(
      refusal("mutation", {
        code: "coverage-unavailable",
        line: `Needs coverage. Install ${FIX}`,
        fix: FIX,
      })?.why,
    ).toMatchObject({ copy: FIX, log: false });
    expect(
      refusal("mutation", {
        code: "coverage-unavailable",
        line: "Needs coverage, see the log",
      })?.why,
    ).toMatchObject({ copy: null, log: true });
  });

  it("reads a completed tests-failed run as current and keeps its diagnosis beneath", () => {
    const row = completed({
      code: "tests-failed",
      line: "3 tests failed, so coverage may read low",
      failing: { count: 3, names: [] },
    });

    expect(row?.state).toEqual({ kind: "current", at: NOW });
    expect(row?.why).toMatchObject({ copy: null, log: true });
  });

  it("reads a completed coverage-unavailable run as current with a fix to copy", () => {
    const row = completed({
      code: "coverage-unavailable",
      line: `No coverage. Install ${FIX}`,
      fix: FIX,
    });

    expect(row?.state).toEqual({ kind: "current", at: NOW });
    expect(row?.why).toMatchObject({ copy: FIX, log: false });
  });

  it("keeps failed and no second line for a failure with no diagnosis", () => {
    const row = scanPanel(
      input({
        run: run({ failures: { crap: "boom" }, ranAt: { crap: NOW } }),
      }),
    ).rows.find((one) => one.key === "crap");

    expect(row?.text.text).toBe("failed, just now");
    expect(row?.why).toBeNull();
  });

  it("gives a live row no second line", () => {
    const model = scanPanel(
      input({
        scanning: true,
        run: run({
          running: ["crap"],
          started: "crap",
          diagnoses: { crap: { code: "tool-missing", line: "x" } },
        }),
      }),
    );

    expect(model.rows.find((row) => row.key === "crap")?.why).toBeNull();
  });

  it("survives a reload from the status alone", () => {
    const row = scanPanel(
      input({
        sensors: [
          {
            name: "crap",
            status: "ran",
            findings: 1,
            modifiedMs: NOW - 5 * MINUTE,
            diagnosis: { code: "tests-failed", line: "3 failed" },
          },
        ],
      }),
    ).rows.find((one) => one.key === "crap");

    expect(row?.text.text).toBe("current, 5 minutes ago");
    expect(row?.why).not.toBeNull();
  });
});

describe("whyOf", () => {
  it("gives no code segment for a fix that is not in the line and still sets copy", () => {
    const why = whyOf({
      code: "tool-missing",
      line: "Missing tool.",
      fix: "do x",
    });

    expect(why.segments).toEqual([{ text: "Missing tool.", code: false }]);
    expect(why.copy).toBe("do x");
  });

  it("keeps a lower-case first letter", () => {
    expect(
      whyOf({ code: "tests-failed", line: "pytest failed." }).segments[0]?.text,
    ).toBe("pytest failed.");
  });

  it("adds exactly one full stop when the line has none and none when it ends in one", () => {
    const text = (line: string) =>
      whyOf({ code: "tests-failed", line })
        .segments.map((one) => one.text)
        .join("");

    expect(text("3 failed")).toBe("3 failed.");
    expect(text("3 failed.")).toBe("3 failed.");
    expect(text("really?")).toBe("really?");
  });
});

describe("scanPanel remembered refusal", () => {
  const remembered = (
    diagnosis: Diagnosis | undefined,
    over: Partial<PanelInput> = {},
    modifiedMs: number | null = NOW - 5 * MINUTE,
  ) =>
    scanPanel(
      input({
        sensors: [
          {
            name: "crap",
            status: "ran",
            findings: 2,
            modifiedMs,
            refusal: {
              reason: "failed",
              ...(diagnosis === undefined ? {} : { diagnosis }),
              at: NOW - MINUTE,
            },
          },
        ],
        ...over,
      }),
    ).rows.find((row) => row.key === "crap");

  it.each(["tool-missing", "tests-failed", "coverage-unavailable"] as const)(
    "reads a %s refusal as failed with the findings' age",
    (code) => {
      const diagnosis: Diagnosis = { code, line: "why" };
      const row = remembered(diagnosis);

      expect(row?.text.text).toBe("failed, 5 minutes ago");
      expect(row?.why).toEqual(whyOf(diagnosis));
    },
  );

  it("reads a refusal with no diagnosis as failed with no second line", () => {
    const row = remembered(undefined);

    expect(row?.text.text).toBe("failed, 5 minutes ago");
    expect(row?.why).toBeNull();
  });

  it("takes the age from the refusal when the sensor has no document", () => {
    const row = remembered(undefined, {}, null);

    expect(row?.text.text).toBe("failed, 1 minute ago");
  });

  it("lets this session's failure outrank a remembered refusal", () => {
    const row = remembered(
      { code: "tests-failed", line: "old" },
      {
        run: run({
          failures: { crap: "refused" },
          diagnoses: { crap: { code: "tool-missing", line: "new" } },
          ranAt: { crap: NOW },
        }),
      },
    );

    expect(row?.text.text).toBe("failed, just now");
    expect(row?.why).toEqual(whyOf({ code: "tool-missing", line: "new" }));
  });

  it("does not turn a failed row into out of date for a module gap", () => {
    const row = remembered(
      { code: "tests-failed", line: "why" },
      { scans: SCANS },
    );

    expect(row?.state.kind).toBe("failed");
  });
});

describe("the scope's canvasEmpty flag", () => {
  it("is true at exactly 0 modules and false at 1", () => {
    expect(
      scanPanel(input({ view: { name: "v", modules: [] } })).scope?.canvasEmpty,
    ).toBe(true);
    expect(
      scanPanel(input({ view: { name: "v", modules: ["a.py"] } })).scope
        ?.canvasEmpty,
    ).toBe(false);
  });
});
