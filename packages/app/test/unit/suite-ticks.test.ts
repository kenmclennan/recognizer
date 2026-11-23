import type { SuiteResult } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import type { ResponsibilityState } from "../../src/responsibility-model";
import {
  afterSuiteTick,
  NO_RUN,
  type PanelInput,
  type ScanTicks,
  sensorTickState,
  visibleSuiteTicks,
} from "../../src/scan-panel-model";
import type { SensorStatus, ShippedSensors } from "../../src/sensor-run";
import { plainSensor } from "../../src/shipped-fake";
import {
  foldSummary,
  languageTag,
  shortAge,
  suiteState,
} from "../../src/suite-results";
import { scanPanelSync as scanPanel } from "../fixtures";

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

const SHIPPED: ShippedSensors = {
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
    scan: null,
    config: CONFIG,
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
    shipped: SHIPPED,
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

describe("shortAge", () => {
  it.each([
    [59 * 1000, "now"],
    [60 * 1000, "1m"],
    [59 * MINUTE, "59m"],
    [60 * MINUTE, "1h"],
    [23 * HOUR + 59 * MINUTE, "23h"],
    [24 * HOUR, "1d"],
  ])("reads %i ms as %s", (ms, text) => {
    expect(shortAge(ms)).toBe(text);
  });
});

describe("suite states", () => {
  it("reads each status as its icon, short text and full hover text", () => {
    expect(suiteState(ok("unit", 3 * HOUR), NOW)).toMatchObject({
      kind: "ok",
      icon: "circle-check",
      text: "3h",
      title: "current, 3 hours ago",
    });
    expect(
      suiteState(
        {
          name: "web",
          status: "failed",
          ranAt: ago(5 * MINUTE),
          reason: "no coverage report",
        },
        NOW,
      ),
    ).toMatchObject({
      kind: "failed",
      icon: "circle-x",
      text: "5m",
      title: "failed 5 minutes ago: no coverage report",
    });
    expect(
      suiteState(
        {
          name: "unit",
          status: "partial",
          ranAt: ago(2 * DAY),
          measured: 11,
          total: 29,
        },
        NOW,
      ),
    ).toMatchObject({
      kind: "partial",
      icon: "circle-pause",
      text: "11/29",
      title: "11 of 29 functions, 2 days ago",
    });
    expect(suiteState(undefined, NOW)).toMatchObject({
      kind: "never",
      icon: "circle-dashed",
      text: "never",
      title: "never run",
    });
  });
});

describe("closed fold summary", () => {
  const summarize = (
    results: (SuiteResult | undefined)[],
    all = results.length,
    running = null as {
      suite: string;
      done: number | null;
      total: number | null;
    } | null,
  ) => foldSummary({ all, results, running, now: NOW });

  it("reads none when no suite is ticked", () => {
    expect(summarize([], 3).text).toBe("none");
  });

  it("reads the worst state: failed, then never, then partial, then the oldest age", () => {
    const failed: SuiteResult = {
      name: "web",
      status: "failed",
      ranAt: ago(MINUTE),
    };
    const partial: SuiteResult = {
      name: "integration",
      status: "partial",
      ranAt: ago(MINUTE),
      measured: 1,
      total: 2,
    };

    expect(summarize([ok("unit", HOUR), failed, undefined, partial]).text).toBe(
      "1 failed",
    );
    expect(summarize([ok("unit", HOUR), undefined, partial]).text).toBe(
      "never",
    );
    expect(summarize([ok("unit", HOUR), partial]).text).toBe("partial");
    expect(
      summarize([ok("unit", 3 * HOUR), ok("integration", 2 * DAY)]).text,
    ).toBe("2d");
  });

  it("prefixes ticked over all when only some suites are ticked", () => {
    expect(
      summarize([ok("unit", HOUR), ok("integration", 2 * HOUR)], 3).text,
    ).toBe("2/3 · 2h");
  });

  it("reads the running suite, with the count for Mutation, while scanning", () => {
    expect(
      summarize([ok("unit", HOUR)], 3, {
        suite: "unit",
        done: null,
        total: null,
      }).text,
    ).toBe("unit");
    expect(
      summarize([ok("unit", HOUR)], 3, { suite: "unit", done: 11, total: 29 })
        .text,
    ).toBe("unit 11/29");
  });

  it("tags a language by its short name", () => {
    expect(
      ["python", "typescript", "kotlin", "rust", "csharp"].map(languageTag),
    ).toEqual(["py", "ts", "kt", "rs", "cs"]);
  });
});

describe("result rows from the findings suites array", () => {
  const status = (suites?: SuiteResult[]): SensorStatus => ({
    name: "crap",
    status: "ran",
    findings: 0,
    modifiedMs: NOW,
    ...(suites === undefined ? {} : { suites }),
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
      ["unit", "py", true, "3h"],
      ["integration", "py", false, "never"],
      ["web", "ts", true, "2d"],
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
    expect(row(panel(), "duplication")).toBeUndefined();
    expect(row(panel({ config: null }), "crap")).toBeUndefined();
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
