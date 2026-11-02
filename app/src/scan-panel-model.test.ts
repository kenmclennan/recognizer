import { describe, expect, it } from "vitest";
import type { ScanState } from "./footer-scan";
import { NO_CHANGES } from "./footer-scan";
import type { ResponsibilityState } from "./responsibility-model";
import {
  NO_RUN,
  type PanelInput,
  phasesFor,
  type RunState,
  type ScanPlan,
  scanCaption,
  scanFlags,
  scanLanguages,
  scanPanel,
  sessionStatuses,
} from "./scan-panel-model";
import type { SensorStatus } from "./sensor-run";

const CONFIG = `describer:
  command: [recognizer-describe-claude]
  version: v3
sensors:
  alpha:
    command: [node, "{repository}/a.mjs", "{commit}", "{output}"]
  beta:
    command: [node, "{repository}/b.mjs", "{commit}", "{output}"]
`;

const NOW = 10 * 60000;

const SCAN: ScanState = {
  origin: { branch: "main", commit: "abc1234" },
  scannedAt: 0,
  changes: NO_CHANGES,
  progress: null,
  canShow: false,
  log: null,
};

const LINES: Record<string, ResponsibilityState> = {
  "a.py": { kind: "current", line: "x" },
  "b.py": { kind: "out-of-date", line: "y", reasons: ["source"] },
  "c.py": { kind: "missing" },
  "d.py": { kind: "missing" },
  "e.py": { kind: "unknown", reason: "bad" },
};

function input(overrides: Partial<PanelInput> = {}): PanelInput {
  return {
    scan: SCAN,
    scanFiles: ["scan.typescript.json", "scan.python.json"],
    counts: { modules: 12, edges: 40 },
    config: CONFIG,
    sensors: [{ name: "structure", status: "ran" }],
    structure: { violations: 0, warnings: 0 },
    lines: { modules: Object.keys(LINES), of: (id) => LINES[id] },
    ticks: { describe: false, sensors: false, ticked: null },
    run: NO_RUN,
    scanning: false,
    now: NOW,
    ...overrides,
  };
}

function run(overrides: Partial<RunState>): RunState {
  return { ...NO_RUN, ...overrides };
}

const chips = (model: ReturnType<typeof scanPanel>) =>
  model.sensors.rows.map((row) => `${row.name}: ${row.chip}`);

describe("the Scan panel head and Extract block", () => {
  it("names the last scan's commit and age, and reads nothing for no scan", () => {
    expect(scanPanel(input()).head).toEqual({
      commit: "abc1234",
      ageText: "10 minutes ago",
    });
    expect(scanPanel(input({ scan: null })).head).toBeNull();
  });

  it("shows languages, module and edge counts and reads current when nothing changed", () => {
    expect(scanPanel(input()).extract).toEqual({
      languages: ["python", "typescript"],
      modules: 12,
      edges: 40,
      status: "current",
      tone: "ok",
    });
  });

  it("reads files changed since the commit when files or the commit moved", () => {
    const changed: ScanState = {
      ...SCAN,
      changes: { files: [{ path: "a.py", kind: "modified" }], moved: null },
    };
    const moved: ScanState = {
      ...SCAN,
      changes: { files: [], moved: { branch: "main", commit: "def5678" } },
    };

    expect(scanPanel(input({ scan: changed })).extract.status).toBe(
      "files changed since abc1234",
    );
    expect(scanPanel(input({ scan: moved })).extract.tone).toBe("amber");
  });

  it("reads no scan yet when there is no scan", () => {
    expect(scanPanel(input({ scan: null })).extract.status).toBe("no scan yet");
  });
});

describe("the Describe block", () => {
  it("counts current, out of date and missing lines and names the describer", () => {
    expect(scanPanel(input()).describe).toEqual({
      ticked: false,
      tickable: true,
      counts: { current: 1, outOfDate: 1, missing: 2 },
      describer: "recognizer-describe-claude v3",
    });
  });

  it("is ticked only when the tick is on and a describer is registered", () => {
    const ticks = { describe: true, sensors: false, ticked: null };

    expect(scanPanel(input({ ticks })).describe.ticked).toBe(true);

    const none = scanPanel(
      input({ ticks, config: "sensors:\n  alpha:\n    command: [x]\n" }),
    );

    expect(none.describe).toMatchObject({
      ticked: false,
      tickable: false,
      describer: null,
    });
  });
});

describe("the Sensors block", () => {
  it("lists structure first and then registered sensors in config order", () => {
    const model = scanPanel(input());

    expect(model.sensors.rows.map((row) => row.name)).toEqual([
      "structure",
      "alpha",
      "beta",
    ]);
    expect(chips(model)).toEqual([
      "structure: every scan",
      "alpha: not run",
      "beta: not run",
    ]);
  });

  it("gives the structure row no tick box and its counts as a toned chip", () => {
    const [structure, alpha] = scanPanel(
      input({ structure: { violations: 2, warnings: 1 } }),
    ).sensors.rows;

    expect(structure.tickable).toBe(false);
    expect(structure.extra).toEqual({
      text: "2 violations, 1 warning",
      tone: "red",
    });
    expect(alpha.tickable).toBe(true);
    expect(
      scanPanel(input({ structure: { violations: 0, warnings: 3 } })).sensors
        .rows[0].extra?.tone,
    ).toBe("amber");
    expect(scanPanel(input()).sensors.rows[0].extra?.tone).toBe("ok");
  });

  it("reads off for the structure row when its status is off", () => {
    const model = scanPanel(
      input({ sensors: [{ name: "structure", status: "off" }] }),
    );

    expect(model.sensors.rows[0]).toMatchObject({ chip: "off", extra: null });
  });

  it("ticks every registered sensor when the remembered list is null and only the listed ones otherwise", () => {
    const all = scanPanel(input()).sensors.rows.slice(1);
    const some = scanPanel(
      input({ ticks: { describe: false, sensors: true, ticked: ["beta"] } }),
    ).sensors.rows.slice(1);

    expect(all.map((row) => row.ticked)).toEqual([true, true]);
    expect(some.map((row) => row.ticked)).toEqual([false, true]);
  });

  it("reads plain ran for a file from an earlier session and ran with the age for one run this session", () => {
    const sensors: SensorStatus[] = [
      { name: "alpha", status: "ran" },
      { name: "beta", status: "ran" },
    ];
    const model = scanPanel(
      input({ sensors, run: run({ ranAt: { beta: NOW - 3 * 60000 } }) }),
    );

    expect(chips(model).slice(1)).toEqual([
      "alpha: ran",
      "beta: ran 3 minutes ago",
    ]);
  });

  it("reads stale and failed from the statuses, failed carrying its reason", () => {
    const model = scanPanel(
      input({
        sensors: [
          { name: "alpha", status: "stale" },
          { name: "beta", status: "failed", reason: "could not be read" },
        ],
      }),
    );

    expect(chips(model).slice(1)).toEqual(["alpha: stale", "beta: failed"]);
    expect(model.sensors.rows[2].reason).toBe("could not be read");
  });

  it("reads running while the name is in flight, over any status", () => {
    const model = scanPanel(
      input({
        sensors: [{ name: "alpha", status: "ran" }],
        run: run({ running: ["alpha"] }),
      }),
    );

    expect(model.sensors.rows[1].chip).toBe("running");
  });

  it("shows a held failure as failed with its reason while the status reads not run", () => {
    const model = scanPanel(
      input({ run: run({ failures: { alpha: "the sensor broke" } }) }),
    );

    expect(model.sensors.rows[1]).toMatchObject({
      chip: "failed",
      reason: "the sensor broke",
    });
    expect(model.sensors.rows[2].chip).toBe("not run");
  });

  it("marks the rail on a failed status, a held failure or an invalid config, and otherwise not", () => {
    expect(scanPanel(input()).mark).toBe(false);
    expect(
      scanPanel(
        input({ sensors: [{ name: "alpha", status: "failed", reason: "x" }] }),
      ).mark,
    ).toBe(true);
    expect(
      scanPanel(input({ run: run({ failures: { alpha: "x" } }) })).mark,
    ).toBe(true);
    expect(
      scanPanel(
        input({
          config: "sensors: [",
          sensors: [{ name: "config.yaml", status: "failed", reason: "bad" }],
        }),
      ).mark,
    ).toBe(true);
  });

  it("gives no registered rows and no tick for an invalid or missing config", () => {
    expect(
      scanPanel(input({ config: "sensors: [" })).sensors.rows,
    ).toHaveLength(1);

    const none = scanPanel(input({ config: null }));

    expect(none.sensors.rows).toHaveLength(1);
    expect(none.sensors.tickable).toBe(false);
  });

  it("drops a held failure for a name no longer in the config from the rows while it still counts toward the mark", () => {
    const model = scanPanel(
      input({ run: run({ failures: { gone: "old failure" } }) }),
    );

    expect(model.sensors.rows.map((row) => row.name)).not.toContain("gone");
    expect(model.mark).toBe(true);
  });
});

describe("phasesFor", () => {
  const registered = ["alpha", "beta"];

  it("takes every registered sensor when the remembered list is null", () => {
    expect(
      phasesFor(
        { describe: true, sensors: true, ticked: null },
        registered,
        true,
      ),
    ).toEqual({
      plan: { describe: true, sense: ["alpha", "beta"] },
      dropped: [],
    });
  });

  it("keeps the registered names, lists the unregistered ones as dropped and leaves a newly registered one unticked", () => {
    expect(
      phasesFor(
        { describe: false, sensors: true, ticked: ["alpha", "gone"] },
        registered,
        true,
      ),
    ).toEqual({
      plan: { describe: false, sense: ["alpha"] },
      dropped: ["gone"],
    });
  });

  it("runs no sensors when the Sensors tick is off and no describe without a describer", () => {
    expect(
      phasesFor(
        { describe: true, sensors: false, ticked: null },
        registered,
        false,
      ),
    ).toEqual({ plan: { describe: false, sense: [] }, dropped: [] });
  });
});

describe("scanCaption and scanFlags", () => {
  const plan = (describe: boolean, sense: string[]): ScanPlan => ({
    describe,
    sense,
  });

  it("names what will run", () => {
    expect(scanCaption(plan(false, []), false)).toBe("scans current");
    expect(scanCaption(plan(false, []), true)).toBe("extract");
    expect(scanCaption(plan(true, []), false)).toBe("scans current, describe");
    expect(scanCaption(plan(false, ["a"]), false)).toBe(
      "scans current, 1 sensor",
    );
    expect(scanCaption(plan(true, ["a", "b"]), true)).toBe(
      "extract, describe, 2 sensors",
    );
  });

  it("builds the flags and never asks for an extraction", () => {
    expect(scanFlags(plan(false, []))).toEqual([]);
    expect(scanFlags(plan(true, ["a", "b"]))).toEqual([
      "--describe",
      "--sense",
      "a,b",
    ]);

    for (const describe of [false, true]) {
      for (const sense of [[], ["a"]]) {
        expect(scanFlags(plan(describe, sense))).not.toContain("--extract");
      }
    }
  });

  it("puts the caption and the command line on the button and swaps it for Stop while scanning", () => {
    const ticks = { describe: true, sensors: true, ticked: null };
    const idle = scanPanel(input({ ticks })).button;

    expect(idle).toEqual({
      mode: "scan",
      caption: "scans current, describe, 2 sensors",
      flags: "recognizer scan --describe --sense alpha,beta",
    });
    expect(scanPanel(input({ ticks, scanning: true })).button.mode).toBe(
      "stop",
    );
  });

  it("predicts an extraction when there is no scan or files changed", () => {
    expect(scanPanel(input({ scan: null })).button.caption).toBe("extract");
  });
});

describe("scanLanguages", () => {
  it("takes languages only from scan.<language>.json names", () => {
    expect(
      scanLanguages(["scan.rust.json", "other.json", "scan.json"]),
    ).toEqual(["rust"]);
  });
});

describe("sessionStatuses", () => {
  it("returns the file statuses untouched when nothing failed this session", () => {
    const sensors: SensorStatus[] = [{ name: "alpha", status: "not run" }];

    expect(sessionStatuses(sensors, NO_RUN)).toBe(sensors);
  });

  it("reads a sensor that failed this session as failed with its reason", () => {
    const run: RunState = { ...NO_RUN, failures: { alpha: "exit 1" } };

    expect(
      sessionStatuses(
        [
          { name: "structure", status: "ran" },
          { name: "alpha", status: "not run" },
        ],
        run,
      ),
    ).toEqual([
      { name: "structure", status: "ran" },
      { name: "alpha", status: "failed", reason: "exit 1" },
    ]);
  });

  it("adds a failed sensor the files do not list", () => {
    const run: RunState = { ...NO_RUN, failures: { beta: "boom" } };

    expect(sessionStatuses([], run)).toEqual([
      { name: "beta", status: "failed", reason: "boom" },
    ]);
  });
});
