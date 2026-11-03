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
import type { SensorStatus, ShippedSensors } from "./sensor-run";

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
    ticks: {
      describe: false,
      measure: false,
      overlays: null,
      sensors: false,
      ticked: null,
      once: [],
    },
    run: NO_RUN,
    overlays: [],
    measureRun: NO_RUN,
    scanning: false,
    now: NOW,
    shipped: null,
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
    const ticks = {
      describe: true,
      measure: false,
      overlays: null,
      sensors: false,
      ticked: null,
      once: [],
    };

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
      input({
        ticks: {
          describe: false,
          measure: false,
          overlays: null,
          sensors: true,
          ticked: ["beta"],
          once: [],
        },
      }),
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

describe("report rows", () => {
  const sensors: SensorStatus[] = [
    { name: "structure", status: "ran" },
    {
      name: "zeta",
      status: "stale",
      reported: { at: new Date(0).toISOString(), commit: "def4567890" },
    },
    {
      name: "review",
      status: "ran",
      reported: { at: new Date(7 * 60000).toISOString(), commit: "abc1234567" },
    },
    {
      name: "odd",
      status: "ran",
      reported: { at: "not a time", commit: "abc1234567" },
    },
  ];

  it("lists each report by name with its age chip and short commit, apart from the registered rows", () => {
    const model = scanPanel(input({ sensors }));

    expect(model.sensors.reports).toEqual([
      { name: "odd", chip: "reported", commit: "abc1234", stale: false },
      {
        name: "review",
        chip: "reported 3 minutes ago",
        commit: "abc1234",
        stale: false,
      },
      {
        name: "zeta",
        chip: "reported 10 minutes ago",
        commit: "def4567",
        stale: true,
      },
    ]);
    expect(model.sensors.rows.map((row) => row.name)).toEqual([
      "structure",
      "alpha",
      "beta",
    ]);
  });

  it("never lets a report reach the tick state, the flags or the caption", () => {
    const model = scanPanel(
      input({
        sensors,
        ticks: {
          describe: false,
          measure: false,
          overlays: null,
          sensors: true,
          ticked: null,
          once: [],
        },
      }),
    );

    expect(model.sensors.tickable).toBe(true);
    expect(model.button.flags).toBe("recognizer scan --sense alpha,beta");
    expect(model.button.summary).toBe("scans current, 2 sensors");
    expect(scanPanel(input({ config: null, sensors })).sensors.tickable).toBe(
      false,
    );
  });

  it("has no report rows when no document carries the mark", () => {
    expect(scanPanel(input()).sensors.reports).toEqual([]);
  });
});

describe("phasesFor", () => {
  const registered = ["alpha", "beta"];

  it("takes every registered sensor when the remembered list is null", () => {
    expect(
      phasesFor(
        {
          describe: true,
          measure: false,
          overlays: null,
          sensors: true,
          ticked: null,
          once: [],
        },
        registered,
        true,
      ),
    ).toEqual({
      plan: { describe: true, measure: [], sense: ["alpha", "beta"] },
      dropped: [],
    });
  });

  it("keeps the registered names, lists the unregistered ones as dropped and leaves a newly registered one unticked", () => {
    expect(
      phasesFor(
        {
          describe: false,
          measure: false,
          overlays: null,
          sensors: true,
          ticked: ["alpha", "gone"],
          once: [],
        },
        registered,
        true,
      ),
    ).toEqual({
      plan: { describe: false, measure: [], sense: ["alpha"] },
      dropped: ["gone"],
    });
  });

  it("runs no sensors when the Sensors tick is off and no describe without a describer", () => {
    expect(
      phasesFor(
        {
          describe: true,
          measure: false,
          overlays: null,
          sensors: false,
          ticked: null,
          once: [],
        },
        registered,
        false,
      ),
    ).toEqual({
      plan: { describe: false, measure: [], sense: [] },
      dropped: [],
    });
  });
});

describe("scanCaption and scanFlags", () => {
  const plan = (
    describe: boolean,
    sense: string[],
    measure: string[] = [],
  ): ScanPlan => ({
    describe,
    measure,
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

  it("puts the label, the summary and the command line on the button and swaps it for Stop while scanning", () => {
    const ticks = {
      describe: true,
      measure: false,
      overlays: null,
      sensors: true,
      ticked: null,
      once: [],
    };
    const idle = scanPanel(input({ ticks })).button;

    expect(idle).toEqual({
      mode: "scan",
      label: "Scan",
      summary: "scans current, describe, 2 sensors",
      flags: "recognizer scan --describe --sense alpha,beta",
    });
    expect(scanPanel(input({ ticks, scanning: true })).button.mode).toBe(
      "stop",
    );
  });

  it("predicts an extraction when there is no scan or files changed", () => {
    expect(scanPanel(input({ scan: null })).button.summary).toBe("extract");
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

const shipped = (...names: string[]): ShippedSensors => ({
  status: "ok",
  sensors: names.map((name) => ({
    name,
    line: `${name} judges something`,
    defaults: {},
  })),
});

describe("the Add a sensor block", () => {
  it("lists a shipped sensor that is not registered, with its line", () => {
    const model = scanPanel(input({ shipped: shipped("duplication") }));

    expect(model.sensors.add).toEqual({
      status: "list",
      items: [{ name: "duplication", line: "duplication judges something" }],
    });
  });

  it("is hidden while the list is unread and when every shipped sensor is registered", () => {
    expect(scanPanel(input()).sensors.add).toEqual({ status: "hidden" });
    expect(
      scanPanel(input({ shipped: shipped("alpha", "beta") })).sensors.add,
    ).toEqual({ status: "hidden" });
  });

  it("carries the reason when the list is unavailable", () => {
    expect(
      scanPanel(
        input({ shipped: { status: "unavailable", reason: "not installed" } }),
      ).sensors.add,
    ).toEqual({ status: "unavailable", reason: "not installed" });
  });

  it("lists only the unregistered one and marks the registered shipped one removable", () => {
    const model = scanPanel(
      input({ shipped: shipped("alpha", "duplication") }),
    );
    const [, alpha, beta] = model.sensors.rows;

    expect(model.sensors.add).toEqual({
      status: "list",
      items: [{ name: "duplication", line: "duplication judges something" }],
    });
    expect(alpha.removable).toBe(true);
    expect(beta.removable).toBe(false);
  });

  it("never marks structure or a registered third-party sensor removable", () => {
    const rows = scanPanel(input({ shipped: shipped("duplication") })).sensors
      .rows;

    expect(rows.map((row) => row.removable)).toEqual([false, false, false]);
  });

  it("is not editable while a scan runs", () => {
    expect(scanPanel(input()).sensors.editable).toBe(true);
    expect(scanPanel(input({ scanning: true })).sensors.editable).toBe(false);
  });
});

const MEASURE_CONFIG = `${CONFIG}overlays:
  cov:
    command: [node, "{repository}/cov.mjs", "{commit}", "{output}"]
    metrics:
      - { name: line_coverage, type: ratio, granularity: module, bad: low }
  mut:
    command: [recognizer-sensors, mutate]
    runs_tests: true
    metrics:
      - { name: score, type: ratio, granularity: member, bad: low }
`;

function overlayText(commit: string, modified = false): string {
  return JSON.stringify({
    overlay_version: 1,
    commit,
    modified,
    producer: { name: "p", version: "1" },
    metrics: [
      {
        name: "line_coverage",
        type: "ratio",
        granularity: "module",
        bad: "low",
      },
    ],
    values: { line_coverage: { "a.py": 0.5 } },
  });
}

const measureChips = (model: ReturnType<typeof scanPanel>) =>
  model.measure.rows.map((row) => `${row.name}: ${row.chip}`);

describe("the Measure block", () => {
  const withOverlays = (overrides: Partial<PanelInput> = {}) =>
    input({ config: MEASURE_CONFIG, ...overrides });

  it("lists one row per registered overlay in config order with its sub-line", () => {
    const { rows } = scanPanel(withOverlays()).measure;

    expect(rows.map((row) => row.name)).toEqual(["cov", "mut"]);
    expect(rows.map((row) => row.subline)).toEqual([
      "node",
      "recognizer-sensors · runs the tests · ticked for one Scan only",
    ]);
  });

  it("is not tickable with no overlay registered", () => {
    const model = scanPanel(input());

    expect(model.measure).toEqual({ ticked: false, tickable: false, rows: [] });
  });

  it("ticks every overlay when the list is null and only the listed ones otherwise", () => {
    const ticks = {
      describe: false,
      measure: true,
      overlays: null,
      sensors: false,
      ticked: null,
      once: [],
    };

    expect(
      scanPanel(withOverlays({ ticks })).measure.rows.map((row) => row.ticked),
    ).toEqual([true, false]);
    expect(
      scanPanel(
        withOverlays({ ticks: { ...ticks, overlays: ["mut"] } }),
      ).measure.rows.map((row) => row.ticked),
    ).toEqual([false, false]);
    expect(
      scanPanel(
        withOverlays({ ticks: { ...ticks, once: ["mut"] } }),
      ).measure.rows.map((row) => row.ticked),
    ).toEqual([true, true]);
    expect(scanPanel(withOverlays({ ticks })).measure.ticked).toBe(true);
  });

  it("reads not run with no file and with an unparseable file", () => {
    expect(measureChips(scanPanel(withOverlays()))).toEqual([
      "cov: not run",
      "mut: not run",
    ]);
    expect(
      measureChips(
        scanPanel(withOverlays({ overlays: [{ name: "cov", text: "{" }] })),
      )[0],
    ).toBe("cov: not run");
  });

  it("reads stale when the commit differs and when there is no scan", () => {
    const overlays = [{ name: "cov", text: overlayText("other") }];

    expect(measureChips(scanPanel(withOverlays({ overlays })))[0]).toBe(
      "cov: stale",
    );

    const same = [{ name: "cov", text: overlayText("abc1234") }];

    expect(
      measureChips(scanPanel(withOverlays({ overlays: same, scan: null })))[0],
    ).toBe("cov: stale");
  });

  it("reads ran when the overlay's full commit extends the scan's short commit", () => {
    const full = "abc1234".padEnd(40, "0");
    const overlays = [{ name: "cov", text: overlayText(full) }];

    expect(measureChips(scanPanel(withOverlays({ overlays })))[0]).toBe(
      "cov: ran",
    );
  });

  it("reads modified tree, ran with a time and plain ran", () => {
    const modified = [{ name: "cov", text: overlayText("abc1234", true) }];
    const clean = [{ name: "cov", text: overlayText("abc1234") }];

    expect(
      measureChips(scanPanel(withOverlays({ overlays: modified })))[0],
    ).toBe("cov: modified tree");
    expect(measureChips(scanPanel(withOverlays({ overlays: clean })))[0]).toBe(
      "cov: ran",
    );
    expect(
      measureChips(
        scanPanel(
          withOverlays({
            overlays: clean,
            measureRun: run({ ranAt: { cov: 0 } }),
          }),
        ),
      )[0],
    ).toBe("cov: ran 10 minutes ago");
  });

  it("reads ran just now for an overlay a measure phase finished this moment", () => {
    const clean = [{ name: "cov", text: overlayText("abc1234") }];

    expect(
      measureChips(
        scanPanel(
          withOverlays({
            overlays: clean,
            measureRun: run({ ranAt: { cov: NOW } }),
          }),
        ),
      )[0],
    ).toBe("cov: ran just now");
  });

  it("reads running and failed with the held reason, ahead of the file", () => {
    const clean = [{ name: "cov", text: overlayText("abc1234") }];
    const running = scanPanel(
      withOverlays({ overlays: clean, measureRun: run({ running: ["cov"] }) }),
    );
    const failed = scanPanel(
      withOverlays({
        overlays: clean,
        measureRun: run({ failures: { cov: "boom" } }),
      }),
    );

    expect(running.measure.rows[0]).toMatchObject({
      chip: "running",
      tone: "amber",
    });
    expect(failed.measure.rows[0]).toMatchObject({
      chip: "failed",
      tone: "red",
      reason: "boom",
    });
    expect(failed.mark).toBe(true);
  });

  it("keeps an overlay and a sensor of the same name apart", () => {
    const config = `${CONFIG}overlays:
  alpha:
    command: [node]
    metrics:
      - { name: line_coverage, type: ratio, granularity: module, bad: low }
`;
    const model = scanPanel(
      input({ config, run: run({ failures: { alpha: "sensor boom" } }) }),
    );

    expect(model.measure.rows[0]).toMatchObject({
      name: "alpha",
      chip: "not run",
    });
    expect(chips(model)).toContain("alpha: failed");
  });
});

describe("the measure phase in the plan", () => {
  const ticks = {
    describe: false,
    measure: true,
    overlays: ["cov", "gone"],
    sensors: false,
    ticked: null,
    once: [],
  };

  it("drops an unregistered ticked overlay and returns nothing when the tick is off", () => {
    expect(phasesFor(ticks, [], false, ["cov", "mut"]).plan.measure).toEqual([
      "cov",
    ]);
    expect(
      phasesFor({ ...ticks, measure: false }, [], false, ["cov"]).plan.measure,
    ).toEqual([]);
  });

  it("puts --measure between --describe and --sense", () => {
    expect(
      scanFlags({ describe: true, measure: ["cov", "mut"], sense: ["a"] }),
    ).toEqual(["--describe", "--measure", "cov,mut", "--sense", "a"]);
  });

  it("builds the caption with measurers and the singular forms", () => {
    const plan: ScanPlan = {
      describe: true,
      measure: ["cov", "mut"],
      sense: ["a", "b", "c"],
    };

    expect(scanCaption(plan, false)).toBe(
      "scans current, describe, 2 measurers, 3 sensors",
    );
    expect(scanCaption({ ...plan, measure: ["cov"], sense: ["a"] }, true)).toBe(
      "extract, describe, 1 measurer, 1 sensor",
    );
    expect(scanCaption({ ...plan, measure: [] }, false)).not.toContain(
      "measurer",
    );
  });
});

describe("a test-running overlay in the plan", () => {
  const ticks = {
    describe: false,
    measure: true,
    overlays: null,
    sensors: false,
    ticked: null,
    once: [] as string[],
  };

  it("is left out of all ticked and of a stored list that names it", () => {
    expect(
      phasesFor(ticks, [], false, ["cov", "mut"], ["mut"]).plan.measure,
    ).toEqual(["cov"]);
    expect(
      phasesFor(
        { ...ticks, overlays: ["cov", "mut"] },
        [],
        false,
        ["cov", "mut"],
        ["mut"],
      ).plan.measure,
    ).toEqual(["cov"]);
  });

  it("runs only through once", () => {
    expect(
      phasesFor({ ...ticks, once: ["mut"] }, [], false, ["cov", "mut"], ["mut"])
        .plan.measure,
    ).toEqual(["cov", "mut"]);
    expect(
      phasesFor(
        { ...ticks, overlays: [], once: ["mut"] },
        [],
        false,
        ["cov", "mut"],
        ["mut"],
      ).plan.measure,
    ).toEqual(["mut"]);
  });
});
