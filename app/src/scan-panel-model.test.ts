import type { Scan } from "recognizer";
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
  model.rows.map((row) => `${row.name}: ${row.state.text}`);

const fresh = input({
  scan: null,
  lines: { modules: ["a.py"], of: () => ({ kind: "missing" }) },
});

describe("scanPanel rows", () => {
  it("lists Descriptions, shipped sensors by display name, then third-party sensors in config order", () => {
    expect(scanPanel(input()).rows.map((row) => row.name)).toEqual([
      "Descriptions",
      "C.R.A.P.",
      "Duplication",
      "Mutation",
      "alpha",
      "beta",
    ]);
  });

  it("omits a shipped sensor that is not listed and never offers a disabled checkbox", () => {
    const rows = scanPanel(input()).rows;

    expect(rows.map((row) => row.key)).not.toContain("thresholds");
    expect(rows.every((row) => row.tickable)).toBe(true);
  });

  it("disables every row while scanning and none otherwise", () => {
    expect(scanPanel(input()).rows.some((row) => row.disabled)).toBe(false);
    expect(
      scanPanel(input({ scanning: true })).rows.every((row) => row.disabled),
    ).toBe(true);
  });

  it("titles a shipped row with the registry's sentence and Descriptions with the mock's wording", () => {
    const rows = scanPanel(input()).rows;

    expect(rows[0]?.title).toBe(
      "Writes one line per module saying what it is responsible for.",
    );
    expect(rows.find((row) => row.key === "crap")?.title).toBe(
      "C.R.A.P.: Change Risk Anti-Patterns. C.R.A.P. does its thing.",
    );
  });

  it("shows Descriptions and third-party rows only when the shipped list is unavailable", () => {
    const model = scanPanel(
      input({ shipped: { status: "unavailable", reason: "old" } }),
    );

    expect(model.rows.map((row) => row.name)).toEqual([
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

describe("scanPanel header", () => {
  it("reads Not scanned yet without a scan", () => {
    expect(scanPanel(fresh).header).toEqual({
      text: "Not scanned yet",
      changed: null,
    });
  });

  it("reads Ran with an age and no sha", () => {
    expect(scanPanel(input()).header).toEqual({
      text: "Ran 27 minutes ago",
      changed: null,
    });
  });

  it("adds the amber phrase when files changed or the commit moved", () => {
    const files = scanPanel(
      input({
        scan: { ...SCAN, changes: { files: ["a.py"], moved: null } as never },
      }),
    );
    const moved = scanPanel(
      input({
        scan: {
          ...SCAN,
          changes: { files: [], moved: { from: "a", to: "b" } } as never,
        },
      }),
    );

    expect(files.header.changed).toBe("files changed since");
    expect(moved.header.changed).toBe("files changed since");
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
  it("reads not yet run on a fresh repository", () => {
    expect(states(scanPanel(fresh))).toEqual([
      "Descriptions: 1 to describe",
      "C.R.A.P.: not yet run",
      "Duplication: not yet run",
      "Mutation: not yet run",
      "alpha: not yet run",
      "beta: not yet run",
    ]);
    expect(
      scanPanel(fresh).rows.every((row) => row.state.tone === "muted"),
    ).toBe(true);
  });

  it("counts current lines and the age from the responsibilities file", () => {
    const model = scanPanel(
      input({
        describedAt: NOW - 2 * 24 * 60 * MINUTE,
        lines: allCurrent(["a.py", "b.py"]),
      }),
    );

    expect(model.rows[0]?.state).toEqual({
      text: "2 modules described, 2 days ago",
      tone: "ok",
    });
  });

  it("says 1 module described and drops the age when none is known", () => {
    const model = scanPanel(
      input({
        lines: allCurrent(["a.py"]),
      }),
    );

    expect(model.rows[0]?.state.text).toBe("1 module described");
  });

  it("counts every missing or out-of-date module as to describe", () => {
    const modules = Array.from({ length: 40 }, (_, at) => `m${at}.py`);
    const model = scanPanel(
      input({
        lines: {
          modules,
          of: (id) =>
            id === "m0.py"
              ? { kind: "out-of-date", line: "x", reasons: ["source"] }
              : { kind: "missing" },
        },
      }),
    );

    expect(model.rows[0]?.state).toEqual({
      text: "40 to describe",
      tone: "muted",
    });
  });

  it("keeps the last-run text when no module is stale", () => {
    const model = scanPanel(
      input({
        describedAt: NOW - MINUTE,
        lines: allCurrent(["a.py", "b.py"]),
      }),
    );

    expect(model.rows[0]?.state.text).toBe("2 modules described, 1 minute ago");
  });

  it("reads the finished of total count for Descriptions while it runs", () => {
    const model = scanPanel(
      input({
        scanning: true,
        run: run({ running: ["describe"], started: "describe" }),
        describeProgress: { entries: 12, total: 40 },
      }),
    );

    expect(model.rows[0]?.state).toEqual({ text: "12 of 40", tone: "run" });
  });

  it("counts findings with the age from the findings file and says 1 finding", () => {
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

    expect(states(model)).toContain("C.R.A.P.: 16 findings, 27 minutes ago");
    expect(states(model)).toContain("Duplication: 1 finding, just now");
  });

  it("keeps a findings count in ok tone for an earlier commit", () => {
    const model = scanPanel(
      input({
        sensors: [
          { name: "alpha", status: "stale", findings: 3, modifiedMs: NOW },
        ],
      }),
    );

    expect(model.rows.find((row) => row.key === "alpha")?.state).toEqual({
      text: "3 findings, just now",
      tone: "ok",
    });
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

    expect(states(model)).toContain("alpha: 2 findings, 2 minutes ago");
  });

  it.each([
    { measured: 0, total: 5, text: "stopped, nothing measured", tone: "muted" },
    {
      measured: 2,
      total: 5,
      text: "stopped, 2 of 5 functions measured",
      tone: "ok",
    },
    {
      measured: 5,
      total: 5,
      text: "stopped, 5 of 5 functions measured",
      tone: "ok",
    },
  ])(
    "reads $text for a stopped document of $measured of $total, ran or stale",
    ({ measured, total, text, tone }) => {
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

        expect(model.rows.find((row) => row.key === "mutation")?.state).toEqual(
          { text: `${text}, 3 minutes ago`, tone },
        );
      }
    },
  );

  it("reads failed with the age from the held failure, in the warn tone", () => {
    const model = scanPanel(
      input({
        run: run({ failures: { crap: "boom" }, ranAt: { crap: NOW } }),
      }),
    );

    expect(model.rows.find((row) => row.key === "crap")?.state).toEqual({
      text: "failed, just now",
      tone: "warn",
    });
  });

  it("reads failed with no age for a findings file that could not be read", () => {
    const model = scanPanel(
      input({
        sensors: [
          { name: "alpha", status: "failed", reason: "could not be read" },
        ],
      }),
    );

    expect(model.rows.find((row) => row.key === "alpha")?.state).toEqual({
      text: "failed",
      tone: "warn",
    });
  });

  it("reads running for the started row and waiting for the other planned rows during a scan", () => {
    const model = scanPanel(
      input({
        scanning: true,
        run: run({ running: ["crap", "duplication"], started: "crap" }),
      }),
    );

    expect(model.rows.find((row) => row.key === "crap")?.state).toEqual({
      text: "running",
      tone: "run",
    });
    expect(model.rows.find((row) => row.key === "duplication")?.state).toEqual({
      text: "waiting",
      tone: "muted",
    });
    expect(model.rows.find((row) => row.key === "mutation")?.state.text).toBe(
      "not yet run",
    );
  });

  it("falls through to the findings count for a planned row that finished in this scan", () => {
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

    expect(model.rows.find((row) => row.key === "crap")?.state.text).toBe(
      "4 findings, just now",
    );
  });

  it("shows the Run button, and a disabled Running one during a scan", () => {
    expect(scanPanel(input()).button).toEqual({
      scanning: false,
      label: "Run",
    });
    expect(scanPanel(input({ scanning: true })).button).toEqual({
      scanning: true,
      label: "Running",
    });
  });
});

describe("scanPanel ticks", () => {
  it("shows nothing ticked on a fresh repository", () => {
    expect(scanPanel(fresh).rows.some((row) => row.ticked)).toBe(false);
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

    expect(ticked).toEqual(["describe", "crap", "duplication"]);
  });

  it("ticks every plain sensor but no tests-running one when never stored and defaulting on", () => {
    const model = scanPanel(
      input({
        ticks: { describe: false, ticked: null, once: [], onlyView: false },
      }),
    );

    expect(
      model.rows.filter((row) => row.ticked).map((row) => row.key),
    ).toEqual(["duplication", "alpha", "beta"]);
  });
  it("ticks nothing when a fresh repository defaults to no sensors", () => {
    const model = scanPanel(
      input({
        ticks: { describe: false, ticked: [], once: [], onlyView: false },
      }),
    );

    expect(model.rows.filter((row) => row.ticked)).toEqual([]);
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

  it("shows the switch only while a view is open, captioned with its name and module count", () => {
    expect(scanPanel(input()).scope).toBeNull();
    expect(scanPanel(input({ view })).scope).toEqual({
      caption: "engine-loop, 1 module",
      on: false,
      disabled: false,
    });
    expect(
      scanPanel(input({ view: { name: "v", modules: ["a.py", "b.py"] } })).scope
        ?.caption,
    ).toBe("v, 2 modules");
  });

  it("locks the switch while scanning and reflects the stored value", () => {
    const model = scanPanel(
      input({ view, scanning: true, ticks: ticked(true) }),
    );

    expect(model.scope).toEqual({
      caption: "engine-loop, 1 module",
      on: true,
      disabled: true,
    });
  });

  it("counts stale modules among the view's with the switch on and all of them with it off", () => {
    const off = scanPanel(input({ view, ticks: ticked(false) }));
    const on = scanPanel(input({ view, ticks: ticked(true) }));
    const other = scanPanel(
      input({ view: { name: "v", modules: ["c.py"] }, ticks: ticked(true) }),
    );

    expect(row(off, "describe")?.state.text).toBe("1 to describe");
    expect(row(on, "describe")?.state.text).toBe("1 module described");
    expect(row(other, "describe")?.state.text).toBe("1 to describe");
  });

  it("keeps the last-run text when the view has no stale module", () => {
    const model = scanPanel(
      input({ view, ticks: ticked(true), describedAt: NOW - MINUTE }),
    );

    expect(row(model, "describe")?.state.text).toBe(
      "1 module described, 1 minute ago",
    );
  });

  it("sizes a ticked Mutation row by the scope and leaves C.R.A.P. and Duplication alone", () => {
    const off = scanPanel(input({ scans: SCANS, ticks: ticked(false) }));
    const whole = scanPanel(
      input({ view, scans: SCANS, ticks: ticked(false) }),
    );
    const on = scanPanel(input({ view, scans: SCANS, ticks: ticked(true) }));

    expect(row(off, "mutation")?.state).toEqual({
      text: "4 functions",
      tone: "size",
    });
    expect(row(whole, "mutation")?.state.text).toBe("4 functions");
    expect(row(on, "mutation")?.state.text).toBe("2 functions");
    expect(row(on, "crap")?.state).toEqual(row(off, "crap")?.state);
    expect(row(on, "duplication")?.state).toEqual(
      row(off, "duplication")?.state,
    );
  });

  it("ignores the stored switch when no view is open", () => {
    const model = scanPanel(input({ scans: SCANS, ticks: ticked(true) }));

    expect(row(model, "mutation")?.state.text).toBe("4 functions");
    expect(model.scope).toBeNull();
  });

  it("shows no size for an unticked Mutation row or while scanning", () => {
    const unticked = scanPanel(
      input({ scans: SCANS, ticks: { ...ticked(false), once: [] } }),
    );
    const busy = scanPanel(
      input({ scans: SCANS, scanning: true, ticks: ticked(false) }),
    );

    expect(row(unticked, "mutation")?.state.text).toBe("not yet run");
    expect(row(busy, "mutation")?.state.text).not.toContain("function");
  });
});
