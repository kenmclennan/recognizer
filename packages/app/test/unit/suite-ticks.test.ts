import {
  afterSuiteTick,
  type SuiteResult,
  suiteStandings,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { NO_CHANGES } from "../../src/footer-scan";
import type { ResponsibilityState } from "../../src/responsibility-model";
import {
  NO_RUN,
  type PanelInput,
  type ScanTicks,
  sensorTickState,
  visibleSuiteTicks,
} from "../../src/scan-panel-model";
import type { InstalledSensors, SensorStatus } from "../../src/sensor-run";
import { LOOK, lookedFold, lookedState } from "../../src/suite-look";
import { configOf, plainSensor, scanPanelSync as scanPanel } from "../fixtures";

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const ALL = ["unit", "integration", "web"];

const CONFIG = `sensors:
  crap: {}
  mutation: {}
tests:
  - name: unit
    language: python
    directory: tests/unit
    command: pytest
    coverage: { path: coverage.xml, format: lcov }
  - name: integration
    language: python
    directory: tests/integration
    command: pytest
    coverage: { path: coverage.xml, format: lcov }
  - name: web
    language: typescript
    directory: web
    command: vitest
    runner: vitest
    coverage: { path: coverage/lcov.info, format: lcov }
`;

const INSTALLED: InstalledSensors = {
  status: "ok",
  sensors: ["crap", "mutation", "duplication"].map((name) =>
    plainSensor(name, {
      display:
        name === "crap"
          ? "C.R.A.P."
          : name === "mutation"
            ? "Mutation"
            : "Duplication",
      description: "x",
      runsTests: name !== "duplication",
    }),
  ),
};

function ticks(over: Partial<ScanTicks> = {}): ScanTicks {
  return {
    describe: false,
    analysis: true,
    ticked: [],
    armed: [],
    onlyView: false,
    suites: {},
    folds: [],
    ...over,
  };
}

const entry = (ticked: string[], known: string[] = ALL) => ({ ticked, known });

function panel(over: Partial<PanelInput> = {}) {
  return scanPanel({
    scan: {
      origin: { branch: "main", commit: "abc1234" },
      scannedAt: 0,
      changes: NO_CHANGES,
      scanning: null,
    },
    config: configOf(CONFIG),
    sensors: [],
    lines: {
      modules: ["a.py"],
      of: () => ({ kind: "missing" }) as ResponsibilityState,
    },
    describedAt: null,
    ticks: ticks(),
    run: NO_RUN,
    scanning: false,
    now: NOW,
    installed: INSTALLED,
    ...over,
  });
}

const row = (model: ReturnType<typeof panel>, key: string) =>
  model.rows.find((one) => one.key === key);

const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ok = (name: string, ms: number): SuiteResult => ({
  name,
  status: "ok",
  ranAt: ago(ms),
});

describe("suite ticks", () => {
  it("shows every suite unticked while its sensor is unticked", () => {
    const stale = ticks({ suites: { crap: entry(ALL) } });

    expect(visibleSuiteTicks(stale, "crap", ALL)).toEqual([]);
    expect(
      visibleSuiteTicks({ ...stale, armed: ["crap"] }, "crap", ALL),
    ).toEqual(ALL);

    const model = panel({ ticks: stale });
    const crap = row(model, "crap");

    expect(crap?.fold?.suites.map((one) => one.ticked)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("reads the sensor as some while only part of its suites are ticked", () => {
    const next = afterSuiteTick(
      ticks({ armed: ["crap"], suites: { crap: entry(ALL) } }),
      "crap",
      "unit",
      false,
      ALL,
    );

    expect(next.armed).toEqual(["crap"]);
    expect(sensorTickState(next, "crap", ALL)).toBe("some");
    expect(row(panel({ ticks: next }), "crap")?.tick).toBe("some");
  });
});

describe("suite look", () => {
  it.each([
    ["ok", "circle-check", "ok"],
    ["failed", "circle-x", "bad"],
    ["partial", "circle-pause", "muted"],
    ["never", "circle-dashed", "muted"],
    ["running", "loader", "run"],
  ] as const)("gives %s the %s icon and %s tone", (kind, icon, tone) => {
    expect(LOOK[kind]).toEqual({ icon, tone });
  });

  it.each(["ok", "failed", "partial", "never", "running"] as const)(
    "maps %s through lookedState and lookedFold to its look",
    (kind) => {
      expect(lookedState({ kind, text: "t", title: "u" })).toEqual({
        kind,
        text: "t",
        title: "u",
        ...LOOK[kind],
      });
      expect(lookedFold({ kind, text: "t" })).toEqual({
        text: "t",
        ...LOOK[kind],
      });
    },
  );
});

describe("closed fold look in the panel", () => {
  const closed = (suites: SuiteResult[]) => {
    const model = panel({
      ticks: ticks({
        armed: ["crap"],
        suites: { crap: entry(ALL) },
      }),
      sensors: [
        {
          name: "crap",
          status: "ran",
          findings: 0,
          modifiedMs: NOW,
          suites: suiteStandings(suites) ?? [],
        },
      ],
    });

    return row(model, "crap");
  };

  it.each([
    ["failed", "circle-x", "bad"],
    ["partial", "circle-pause", "muted"],
    ["ok", "circle-check", "ok"],
  ] as const)("draws a %s sensor with %s and %s", (kind, icon, tone) => {
    const suites: SuiteResult[] = ALL.map((name) => ({
      name,
      status: kind,
      ranAt: ago(HOUR),
      measured: 1,
      total: 2,
    }));
    const crap = closed(suites);

    expect(crap?.text.icon).toBe(icon);
    expect(crap?.tone).toBe(tone);
  });
});

describe("result rows from the findings suites array", () => {
  const status = (suites?: SuiteResult[]): SensorStatus => ({
    name: "crap",
    status: "ran",
    findings: 0,
    modifiedMs: NOW,
    ...(suites === undefined ? {} : { suites: suiteStandings(suites) ?? [] }),
  });
  const armed = ticks({
    armed: ["crap"],
    suites: { crap: entry(["unit", "web"]) },
    folds: ["crap"],
  });

  it("lists every suite with its result under an open fold", () => {
    const model = panel({
      ticks: armed,
      sensors: [
        status([
          ok("unit", 3 * HOUR),
          { name: "integration", status: "never", ranAt: null },
          {
            name: "web",
            status: "failed",
            ranAt: ago(2 * DAY),
            reason: "no coverage report",
          },
        ]),
      ],
    });
    const crap = row(model, "crap");

    expect(crap?.fold?.suites.length).toBeGreaterThan(0);
    expect(crap?.tick).toBe("some");
    expect(crap?.ticked).toBe(false);
    expect(crap?.fold?.open).toBe(true);
    expect(
      crap?.fold?.suites.map((one) => [
        one.name,
        one.tag,
        one.ticked,
        one.state.text,
      ]),
    ).toEqual([
      ["unit", "python", true, "3h"],
      ["integration", "python", false, "never"],
      ["web", "typescript", true, "2d"],
    ]);
    expect(crap?.text.text).toBe("2/3 \u00b7 1 failed");
  });

  it("shows every suite never run for a document without suites", () => {
    const model = panel({ ticks: armed, sensors: [status()] });

    expect(
      row(model, "crap")?.fold?.suites.map((one) => one.state.kind),
    ).toEqual(["never", "never", "never"]);
  });

  it("has no row for an unregistered sensor", () => {
    expect(row(panel(), "duplication")).toMatchObject({
      unregistered: true,
      tickable: false,
    });
    expect(row(panel({ config: null }), "crap")).toMatchObject({
      unregistered: true,
      tickable: false,
    });
  });

  it("reads the fold closed by default and the sensor row still ticked after a scan", () => {
    const after = panel({
      ticks: ticks({
        armed: ["crap"],
        suites: { crap: entry(ALL) },
        folds: [],
      }),
    });

    expect(row(after, "crap")?.fold?.open).toBe(false);
    expect(row(after, "crap")?.ticked).toBe(true);
    expect(row(after, "crap")?.tick).toBe("on");
    expect(row(after, "crap")?.fold?.suites.every((one) => one.ticked)).toBe(
      true,
    );
  });

  it("names the running suite on the sensor row and the suite row", () => {
    const model = panel({
      ticks: ticks({ armed: ["mutation"], suites: { mutation: entry(ALL) } }),
      scanning: true,
      run: { ...NO_RUN, running: ["mutation"] },
      sensorProgress: {
        name: "mutation",
        phase: "sense",
        progress: {
          done: 4,
          total: 12,
          unit: "functions",
          step: "integration",
        },
      },
    });
    const mutation = row(model, "mutation");

    expect(mutation?.text.text).toBe("integration 4/12");
    expect(
      mutation?.fold?.suites.find((one) => one.name === "integration")?.state
        .text,
    ).toBe("4/12");
  });
});
