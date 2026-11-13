import { describe, expect, it } from "vitest";
import type { ResponsibilityState } from "./responsibility-model";
import {
  NO_RUN,
  type PanelInput,
  phasesFor,
  rowSensors,
  type ScanTicks,
  scanPanel,
} from "./scan-panel-model";
import type { SensorStatus, ShippedSensors } from "./sensor-run";
import {
  foldSummary,
  languageTag,
  type SuiteResult,
  shortAge,
  suiteState,
} from "./suite-results";
import {
  afterFoldToggle,
  afterSensorTick,
  afterSuiteTick,
  sensorTickState,
  suiteIsTicked,
  tickedSuites,
} from "./suite-ticks";

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const ALL = ["unit", "integration", "web"];

const CONFIG = `tests:
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
  sensors: ["crap", "mutation", "duplication"].map((name) => ({
    name,
    display:
      name === "crap"
        ? "C.R.A.P."
        : name === "mutation"
          ? "Mutation"
          : "Duplication",
    line: "x",
    defaults: {},
    runsTests: name !== "duplication",
    listed: true,
  })),
};

function ticks(over: Partial<ScanTicks> = {}): ScanTicks {
  return {
    describe: false,
    ticked: [],
    once: [],
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
  ran_at: ago(ms),
});

describe("suite ticks", () => {
  it("reads a suite as ticked when it is in ticked or new to the config, and none when the sensor has no entry", () => {
    const suites = { crap: entry(["unit"], ["unit", "web"]) };

    expect(suiteIsTicked(suites, "crap", "unit")).toBe(true);
    expect(suiteIsTicked(suites, "crap", "web")).toBe(false);
    expect(suiteIsTicked(suites, "crap", "e2e")).toBe(true);
    expect(suiteIsTicked(suites, "mutation", "unit")).toBe(false);
    expect(tickedSuites(suites, "crap", ["unit", "web", "e2e"])).toEqual([
      "unit",
      "e2e",
    ]);
    expect(tickedSuites({}, "crap", ALL)).toEqual([]);
  });

  it("reads the sensor tick as on, some or off from once and the suite ticks", () => {
    const once = ["crap"];

    expect(
      sensorTickState({ once, suites: { crap: entry(ALL) } }, "crap", ALL),
    ).toBe("on");
    expect(
      sensorTickState({ once, suites: { crap: entry(["unit"]) } }, "crap", ALL),
    ).toBe("some");
    expect(
      sensorTickState({ once, suites: { crap: entry([]) } }, "crap", ALL),
    ).toBe("off");
    expect(sensorTickState({ once, suites: {} }, "crap", ALL)).toBe("off");
  });

  it("reads the sensor tick off when it is not in once even with every suite ticked", () => {
    expect(
      sensorTickState({ once: [], suites: { crap: entry(ALL) } }, "crap", ALL),
    ).toBe("off");
  });

  it("arms a sensor with no suite ticked by ticking every suite, and keeps a remembered selection", () => {
    const none = afterSensorTick(ticks(), "crap", ALL);

    expect(none.once).toEqual(["crap"]);
    expect(none.suites.crap).toEqual(entry(ALL));

    const some = afterSensorTick(
      ticks({ suites: { crap: entry(["unit"]) } }),
      "crap",
      ALL,
    );

    expect(some.once).toEqual(["crap"]);
    expect(some.suites.crap?.ticked).toEqual(["unit"]);
  });

  it("disarms an on or some sensor and leaves every suite tick as it was", () => {
    const armed = ticks({
      once: ["crap", "mutation"],
      suites: { crap: entry(["unit", "web"]), mutation: entry(ALL) },
    });
    const next = afterSensorTick(armed, "crap", ALL);

    expect(next.once).toEqual(["mutation"]);
    expect(next.suites).toEqual(armed.suites);
    expect(afterSensorTick(next, "crap", ALL).suites.crap?.ticked).toEqual([
      "unit",
      "web",
    ]);
  });

  it("toggles a suite, stores every configured suite as known and arms its sensor on ticking", () => {
    const next = afterSuiteTick(ticks(), "crap", "web", true, ALL);

    expect(next.suites.crap).toEqual({ ticked: ["web"], known: ALL });
    expect(next.once).toEqual(["crap"]);

    const off = afterSuiteTick(next, "crap", "web", false, ALL);

    expect(off.suites.crap?.ticked).toEqual([]);
    expect(off.once).toEqual(["crap"]);
    expect(sensorTickState(off, "crap", ALL)).toBe("off");
  });

  it("keeps each sensor's suite ticks independent", () => {
    const next = afterSuiteTick(
      ticks({ suites: { mutation: entry(["web"]) } }),
      "crap",
      "unit",
      true,
      ALL,
    );

    expect(next.suites.crap?.ticked).toEqual(["unit"]);
    expect(next.suites.mutation).toEqual(entry(["web"]));
  });

  it("keeps folds closed by default and remembers the ones toggled open", () => {
    expect(ticks().folds).toEqual([]);

    const open = afterFoldToggle(ticks(), "mutation");

    expect(open.folds).toEqual(["mutation"]);
    expect(afterFoldToggle(open, "mutation").folds).toEqual([]);
    expect(afterSensorTick(open, "crap", ALL).folds).toEqual(["mutation"]);
  });
});

describe("phasesFor with suites", () => {
  const rows = rowSensors(CONFIG, SHIPPED);

  it("leaves a sensor out of sense when it is not in once however its suites are ticked", () => {
    const { plan } = phasesFor(ticks({ suites: { crap: entry(ALL) } }), rows);

    expect(plan.sense).toEqual([]);
    expect(plan.suites).toEqual({});
  });

  it("leaves a sensor out of sense when it is in once with no suite ticked", () => {
    const { plan } = phasesFor(
      ticks({ once: ["crap"], suites: { crap: entry([]) } }),
      rows,
    );

    expect(plan.sense).toEqual([]);
  });

  it("returns the ticked suites in config order for each armed sensor", () => {
    const { plan } = phasesFor(
      ticks({
        once: ["crap", "mutation"],
        suites: {
          crap: entry(["web", "unit"]),
          mutation: entry(["integration"]),
        },
      }),
      rows,
    );

    expect(plan.sense).toEqual(["crap", "mutation"]);
    expect(plan.suites).toEqual({
      crap: ["unit", "web"],
      mutation: ["integration"],
    });
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
          ran_at: ago(5 * MINUTE),
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
          ran_at: ago(2 * DAY),
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
      ran_at: ago(MINUTE),
    };
    const partial: SuiteResult = {
      name: "integration",
      status: "partial",
      ran_at: ago(MINUTE),
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
    once: ["crap"],
    suites: { crap: entry(["unit", "web"]) },
    folds: ["crap"],
  });

  it("lists every suite with its result under an open fold", () => {
    const model = panel({
      ticks: armed,
      sensors: [
        status([
          ok("unit", 3 * HOUR),
          { name: "integration", status: "never", ran_at: null },
          {
            name: "web",
            status: "failed",
            ran_at: ago(2 * DAY),
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

  it("has no fold on a sensor that does not run tests and on a repository with no suites", () => {
    expect(row(panel(), "duplication")?.fold).toBeNull();
    expect(row(panel({ config: null }), "crap")?.fold).toBeNull();
  });

  it("reads the fold closed by default and the sensor row unticked after a scan cleared once", () => {
    const after = panel({
      ticks: ticks({ suites: { crap: entry(ALL) }, folds: [] }),
    });

    expect(row(after, "crap")?.fold?.open).toBe(false);
    expect(row(after, "crap")?.ticked).toBe(false);
    expect(row(after, "crap")?.tick).toBe("off");
    expect(row(after, "crap")?.fold?.suites.every((one) => one.ticked)).toBe(
      true,
    );
  });

  it("names the running suite on the sensor row and the suite row", () => {
    const model = panel({
      ticks: ticks({ once: ["mutation"], suites: { mutation: entry(ALL) } }),
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
