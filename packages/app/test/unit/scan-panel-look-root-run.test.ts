import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { webkit } from "../../src/look-page";
import {
  ACCENT,
  eachGroup,
  type Facts,
  GREEN,
  GROUPS3A,
  scanPanelFacts,
} from "../scan-panel-look-root-support";

describe.skipIf(webkit === undefined)("the Scan panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = (await scanPanelFacts([...eachGroup(GROUPS3A)])).facts;
  }, scaledTimeout(900000));

  it("matches the run card while running: A scan is running., every planned row running, the Scanning card with a row bar and a single Stop", () => {
    expect(f.run.first).not.toBeNull();
    expect(f.run.heldSamples).toBe(4);
    expect(f.run.heldPlans).toBe(1);
    expect(f.run.plans).toEqual([
      {
        describe: "stale",
        analysis: true,
        sense: ["tally", "crap"],
        modules: ["app/a.py", "app/b.py"],
        plannedMs: {},
      },
    ]);
    expect(f.run.first.header).toBe("A scan is running.");
    expect(
      f.run.first.rows
        .filter((r: Facts) => r.spinner > 0)
        .map((r: Facts) => r.key),
    ).toEqual(["describe", "crap", "tally"]);
    expect([1, 2, 4].map((i) => f.run.first.rows[i].state)).toEqual([
      "0 of 2",
      "running",
      "running",
    ]);
    expect(f.run.first.rows[1].color).toBe(ACCENT);
    expect(f.run.first.summary).toMatchObject({
      shape: "run-card",
      tone: "run",
      head: "ScanningNo estimate yet",
      bar: 0,
      spinning: true,
    });
    expect(f.run.first.rowBars).toBe(1);
    expect(f.run.first.buttons).toEqual([
      { text: "Stop", disabled: false, spinner: 0 },
    ]);
    expect(f.run.footer.text).toBe(
      "Running Descriptions, tally and C.R.A.P.\u2026 Describing\u2026 0 of 2 files",
    );
    expect(f.run.footer.buttons).toEqual(["bell"]);
    expect(f.run.footerAfter.text).toBe("");
    expect(f.run.footerAfter.buttons).toEqual(["bell"]);
    expect(f.run.first.rows.every((r: Facts) => r.disabled)).toBe(true);
  });

  it("moves each row on as it finishes and draws no bar once the run is over", () => {
    const row = (panel: Facts, key: string) =>
      panel.rows.find((r: Facts) => r.key === key);

    expect(row(f.run.afterDescribe, "tally").state).toBe("running");
    expect(row(f.run.afterDescribe, "crap").state).toBe("running");
    expect(row(f.run.afterDuplication, "crap").state).toBe("now");
    expect(row(f.run.afterDuplication, "crap").color).toBe(GREEN);
    expect(row(f.run.afterDuplication, "tally").state).toBe("running");
    expect(row(f.run.after, "tally").state).toBe("current");
    expect(row(f.run.after, "crap").state).toBe("now");
    expect(f.run.after.header).toBe("Ran just now");
    expect(f.run.after.rowBars).toBe(0);
    expect(f.run.after.summary.bar).toBe(0);
    expect(f.run.after.summary.shape).not.toBe("running");
  });

  it("keeps a tests-running tick after the scan it ran in and writes it", () => {
    expect(f.run.crapTickAfter).toBe(true);
    expect(f.run.written.at(-1)).toContain("crap");
  });

  it("stops a running scan from the Scan panel with a single Stop button, sends scan.stop once and leaves the footer empty", () => {
    expect(f.stopWhileRunning.order).toEqual(["scan-stop"]);
    expect(f.stopWhileRunning.count).toBe(1);
    expect(f.stop.stops).toBe(1);
    expect(f.stop.footer).toBe("");
    expect(f.stop.footerButtons).toEqual(["bell"]);
    expect(f.stop.stopAfter).toBe(0);
    expect(f.stop.button).toBe("Run Descriptions");
    expect(f.stop.disabled).toBe(false);
  });

  it("(non-gating) disables the mode toggle while a scan runs and keeps Stop enabled", () => {
    expect(f.modeWhileRunning.disabled).toEqual([true, true]);
    expect(f.modeWhileRunning.stopEnabled).toBe(true);
  });

  it("disables every row's checkbox while a run is in progress, ignores a label click, and re-enables them on Stop", () => {
    expect(f.ticksWhileRunning.disabled.length).toBeGreaterThan(0);
    expect(f.ticksWhileRunning.disabled.every(Boolean)).toBe(true);
    expect(f.ticksWhileRunning.unchanged).toBe(true);
    expect(f.ticksWhileRunning.stopEnabled).toBe(true);
    expect(f.ticksAfterStop.length).toBeGreaterThan(0);
    expect(f.ticksAfterStop.filter(Boolean)).toHaveLength(0);
  });
});
