import { describe, expect, it } from "vitest";
import type { ScanState } from "./footer-scan";
import { NO_CHANGES } from "./footer-scan";
import type { SensorStatus } from "./sensor-run";
import {
  NO_RUN,
  type PanelInput,
  type RunState,
  scanLanguages,
  sensorsPanel,
} from "./sensors-panel-model";

const CONFIG = `sensors:
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
  rescanning: false,
  sensors: [],
};

function input(overrides: Partial<PanelInput> = {}): PanelInput {
  return {
    scan: SCAN,
    scanFiles: ["scan.typescript.json", "scan.python.json"],
    config: CONFIG,
    sensors: [{ name: "structure", status: "ran" }],
    ticked: [],
    run: NO_RUN,
    now: NOW,
    ...overrides,
  };
}

function run(overrides: Partial<RunState>): RunState {
  return { ...NO_RUN, ...overrides };
}

const chips = (model: ReturnType<typeof sensorsPanel>) =>
  model.rows.map((row) => `${row.name}: ${row.chip}`);

describe("the sensors panel model", () => {
  it("lists structure first and then registered sensors in config order", () => {
    const model = sensorsPanel(input());

    expect(model.rows.map((row) => row.name)).toEqual([
      "structure",
      "alpha",
      "beta",
    ]);
    expect(chips(model)).toEqual([
      "structure: runs with every scan",
      "alpha: not run",
      "beta: not run",
    ]);
  });

  it("gives the structure row no tick box", () => {
    const [structure, alpha] = sensorsPanel(input()).rows;

    expect(structure.tickable).toBe(false);
    expect(alpha.tickable).toBe(true);
  });

  it("reads off for the structure row when its status is off", () => {
    const model = sensorsPanel(
      input({ sensors: [{ name: "structure", status: "off" }] }),
    );

    expect(model.rows[0].chip).toBe("off");
    expect(model.rows[0].tickable).toBe(false);
  });

  it("reads plain ran for a file from an earlier session and ran with the age for one run this session", () => {
    const sensors: SensorStatus[] = [
      { name: "alpha", status: "ran" },
      { name: "beta", status: "ran" },
    ];
    const model = sensorsPanel(
      input({ sensors, run: run({ ranAt: { beta: NOW - 3 * 60000 } }) }),
    );

    expect(chips(model).slice(1)).toEqual([
      "alpha: ran",
      "beta: ran 3 minutes ago",
    ]);
  });

  it("reads stale and failed from the statuses, failed carrying its reason", () => {
    const model = sensorsPanel(
      input({
        sensors: [
          { name: "alpha", status: "stale" },
          { name: "beta", status: "failed", reason: "could not be read" },
        ],
      }),
    );

    expect(chips(model).slice(1)).toEqual(["alpha: stale", "beta: failed"]);
    expect(model.rows[2].reason).toBe("could not be read");
  });

  it("reads running while the name is in flight, over any status", () => {
    const model = sensorsPanel(
      input({
        sensors: [{ name: "alpha", status: "ran" }],
        run: run({ running: ["alpha"] }),
      }),
    );

    expect(model.rows[1].chip).toBe("running");
  });

  it("shows a held failure as failed with its reason while the status reads not run", () => {
    const model = sensorsPanel(
      input({ run: run({ failures: { alpha: "the sensor broke" } }) }),
    );

    expect(model.rows[1].chip).toBe("failed");
    expect(model.rows[1].reason).toBe("the sensor broke");
    expect(model.rows[2].chip).toBe("not run");
  });

  it("enables Run selected only with a tick and Run all only with a registered sensor", () => {
    expect(sensorsPanel(input()).buttons).toEqual({
      runSelected: false,
      runAll: true,
    });
    expect(sensorsPanel(input({ ticked: ["beta"] })).buttons).toEqual({
      runSelected: true,
      runAll: true,
    });
    expect(sensorsPanel(input({ config: null })).buttons).toEqual({
      runSelected: false,
      runAll: false,
    });
  });

  it("disables both buttons while a run is in flight", () => {
    const model = sensorsPanel(
      input({ ticked: ["alpha"], run: run({ running: ["alpha"] }) }),
    );

    expect(model.buttons).toEqual({ runSelected: false, runAll: false });
  });

  it("ignores a tick for a name no longer in the config", () => {
    const model = sensorsPanel(input({ ticked: ["gone"] }));

    expect(model.buttons.runSelected).toBe(false);
  });

  it("marks the rail on a failed status, a held failure or an invalid config, and otherwise not", () => {
    expect(sensorsPanel(input()).mark).toBe(false);
    expect(
      sensorsPanel(
        input({ sensors: [{ name: "alpha", status: "failed", reason: "x" }] }),
      ).mark,
    ).toBe(true);
    expect(
      sensorsPanel(input({ run: run({ failures: { alpha: "x" } }) })).mark,
    ).toBe(true);
    expect(
      sensorsPanel(
        input({
          config: "sensors: [",
          sensors: [{ name: "config.yaml", status: "failed", reason: "bad" }],
        }),
      ).mark,
    ).toBe(true);
  });

  it("gives no registered rows for an invalid or missing config", () => {
    expect(sensorsPanel(input({ config: "sensors: [" })).rows).toHaveLength(1);
    expect(sensorsPanel(input({ config: null })).rows).toHaveLength(1);
  });

  it("drops a held failure for a name no longer in the config from the rows while it still counts toward the mark", () => {
    const model = sensorsPanel(
      input({ run: run({ failures: { gone: "old failure" } }) }),
    );

    expect(model.rows.map((row) => row.name)).not.toContain("gone");
    expect(model.mark).toBe(true);
  });

  it("summarises the last scan with commit, age and the languages from the cache file names", () => {
    const model = sensorsPanel(input());

    expect(model.scan).toEqual({
      commit: "abc1234",
      ageText: "10 minutes ago",
      languages: ["python", "typescript"],
    });
    expect(sensorsPanel(input({ scan: null })).scan).toBeNull();
  });

  it("takes languages only from scan.<language>.json names", () => {
    expect(
      scanLanguages(["scan.rust.json", "other.json", "scan.json"]),
    ).toEqual(["rust"]);
  });
});
