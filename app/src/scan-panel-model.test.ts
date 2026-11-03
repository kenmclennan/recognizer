import { describe, expect, it } from "vitest";
import type { ScanState } from "./footer-scan";
import { NO_CHANGES } from "./footer-scan";
import type { ResponsibilityState } from "./responsibility-model";
import {
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
    ticks: { describe: false, ticked: [], once: [] },
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

  it("reads Scanned with an age and no sha", () => {
    expect(scanPanel(input()).header).toEqual({
      text: "Scanned 27 minutes ago",
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

  it("reads Scanning… while a scan runs", () => {
    expect(scanPanel(input({ scanning: true })).header.text).toBe("Scanning…");
  });
});

describe("scanPanel row states", () => {
  it("reads not yet run on a fresh repository", () => {
    expect(states(scanPanel(fresh))).toEqual([
      "Descriptions: not yet run",
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
    const model = scanPanel(input({ describedAt: NOW - 2 * 24 * 60 * MINUTE }));

    expect(model.rows[0]?.state).toEqual({
      text: "2 modules described, 2 days ago",
      tone: "ok",
    });
  });

  it("says 1 module described and drops the age when none is known", () => {
    const model = scanPanel(
      input({
        lines: {
          modules: ["a.py", "c.py"],
          of: (id) => CURRENT[id] as ResponsibilityState,
        },
      }),
    );

    expect(model.rows[0]?.state.text).toBe("1 module described");
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

  it("shows the Scan button, and a disabled Scanning one during a scan", () => {
    expect(scanPanel(input()).button).toEqual({
      scanning: false,
      label: "Scan",
    });
    expect(scanPanel(input({ scanning: true })).button).toEqual({
      scanning: true,
      label: "Scanning",
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
        ticks: { describe: true, ticked: ["duplication"], once: ["crap"] },
      }),
    );
    const ticked = model.rows.filter((row) => row.ticked).map((row) => row.key);

    expect(ticked).toEqual(["describe", "crap", "duplication"]);
  });

  it("ticks every plain sensor but no tests-running one when never stored and defaulting on", () => {
    const model = scanPanel(
      input({ ticks: { describe: false, ticked: null, once: [] } }),
    );

    expect(
      model.rows.filter((row) => row.ticked).map((row) => row.key),
    ).toEqual(["duplication", "alpha", "beta"]);
  });
  it("ticks nothing when a fresh repository defaults to no sensors", () => {
    const model = scanPanel(
      input({ ticks: { describe: false, ticked: [], once: [] } }),
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
      { describe: true, ticked: ["duplication", "alpha", "ghost"], once: [] },
      rows,
    );

    expect(plan).toEqual({ describe: true, sense: ["duplication", "alpha"] });
    expect(dropped).toEqual(["ghost"]);
  });

  it("adds a tests-running sensor only when it is in once", () => {
    expect(
      phasesFor({ describe: false, ticked: [], once: ["crap"] }, rows).plan
        .sense,
    ).toEqual(["crap"]);
    expect(
      phasesFor({ describe: false, ticked: ["crap"], once: [] }, rows).plan
        .sense,
    ).toEqual([]);
  });

  it("runs every plain sensor when never stored", () => {
    expect(
      phasesFor({ describe: false, ticked: null, once: [] }, rows).plan.sense,
    ).toEqual(["duplication", "alpha"]);
  });
});
