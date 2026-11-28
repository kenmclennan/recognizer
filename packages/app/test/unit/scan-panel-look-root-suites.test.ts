import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { webkit } from "../../src/look-page";
import {
  chunksWith,
  type Facts,
  GROUPS3B,
  scanPanelFacts,
} from "../scan-panel-look-root-support";

describe.skipIf(webkit === undefined)("the Scan panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = (
      await scanPanelFacts([GROUPS3B, ...chunksWith(["ticked", "reopened"])])
    ).facts;
  }, scaledTimeout(900000));

  it("two_quick_tick_clicks_apply_in_order", () => {
    const r = f.rapidTicks;
    expect(r.requests).toEqual([["suite:unit"], ["suite:unit", "suite:web"]]);
    expect(r.after).toEqual({ unit: !r.before.unit, web: !r.before.web });
  });

  it("closes an open suites fold when the Scan panel is reopened", () => {
    expect(f.foldReopened.chevron).toBe("false");
    expect(f.foldReopened.folds).toEqual([]);
  });

  it("keeps an open suites fold open when a Scan rebuilds the explorer", () => {
    const r = f.foldAcrossRebuild;

    expect(r.before.chevron).toBe("true");
    expect(r.before.suites).toBeGreaterThan(0);
    expect(r.before.folds).toEqual(["crap"]);
    expect(r.chevron).toBe("true");
    expect(r.suites).toBe(r.before.suites);
    expect(r.folds).toEqual(["crap"]);
  });

  it("keeps the expanded folders and the open inspector across the first Scan", () => {
    const r = f.memoryAcrossFirstScan;

    expect(r.before.opened.rows).toBeGreaterThan(r.before.rows);
    expect(r.before.opened.inspector).toBe(true);
    expect(r.rows).toBe(r.before.opened.rows);
    expect(r.inspector).toBe(true);
  });

  it("keeps the fold open on a second Scan that updates the explorer in place (non-gating)", () => {
    expect(f.foldSecondScan.chevron).toBe("true");
  });

  it("remembers a tick, a tests-running sensor's tick and a suite tick through the port, and a reopened window reads them back", () => {
    expect(f.ticked.rows).toEqual(["structure", "describe", "crap", "tally"]);
    expect(f.ticked.written).toEqual({
      describe: true,
      analysis: true,
      ticked: ["tally", "crap"],
      onlyView: false,
      suites: {},
      folds: [],
    });
    expect(f.reopened).toEqual(["structure", "describe", "crap", "tally"]);
    expect(f.suiteStart.crap).toEqual({
      ticked: false,
      indeterminate: false,
      state: "none",
    });
    expect(f.suiteStart.fold.open).toBe(false);
    expect(f.suiteOpened.suites.map((s: Facts) => s.name)).toEqual([
      "unit",
      "a-suite-with-a-very-long-name-indeed",
      "web",
    ]);
    expect(f.suiteFoldWritten).toEqual(["crap"]);
    expect(f.suiteAfterTick.written.suites.crap).toEqual({
      ticked: ["unit"],
      known: ["unit", "a-suite-with-a-very-long-name-indeed", "web"],
    });
    expect(f.suiteAfterTick.sensor).toMatchObject({
      ticked: false,
      indeterminate: true,
    });
    expect(f.suiteReopened.fold.open).toBe(false);
    expect(f.suiteReopened.sensor).toMatchObject({
      ticked: false,
      indeterminate: true,
    });
  });

  it("draws a suite whose covered file changed in the out-of-date style of the sensor row and leaves an up-to-date suite ok", () => {
    const r = f.suiteStale;

    expect(r.currentKind).toBe("ok");
    expect(r.current.title).toMatch(/^current, /);
    expect(r.behindKind).toBe("stale");
    expect(r.behind.text).toBe("1 out of date");
    expect(r.behind.title).toMatch(/^1 file out of date, ran /);
    expect(r.behind.icon).toBe(r.alert);
    expect(r.behind.className).toContain("warn");
    expect(r.current.icon).not.toBe(r.behind.icon);
  });

  it("ticks every suite with the sensor and shows the sensor and its suites still ticked after a scan", () => {
    expect(f.suiteArmed).toMatchObject({ ticked: true, indeterminate: false });
    expect(f.suiteAfterScan.plan.suites).toEqual({
      crap: ["unit", "a-suite-with-a-very-long-name-indeed", "web"],
    });
    expect(f.suiteAfterScan.sensor.ticked).toBe(true);
    expect(f.suiteAfterScan.sensor.indeterminate).toBe(false);
    expect(f.suiteAfterScan.fold.open).toBe(false);
  });
});
