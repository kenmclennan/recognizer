import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { webkit } from "../../src/look-page";
import {
  ACCENT,
  type Facts,
  GROUPS,
  NAMES,
  scanPanelFacts,
} from "../scan-panel-look-root-support";

describe.skipIf(webkit === undefined)("the Scan panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = (await scanPanelFacts([GROUPS])).facts;
  }, scaledTimeout(900000));

  it("sits third on the rail as Scan, swaps with the tree and runs nothing on open", () => {
    expect(f.fresh.order).toEqual([
      "rail-files",
      "rail-commits",
      "rail-views",
      "rail-notes",
      "rail-scan",
      "rail-findings",
      "rail-setup",
      "rail-settings",
    ]);
    expect(f.fresh.panelOpen).toBe(true);
    expect(f.fresh.files).toBe(false);
    expect(f.fresh.ran).toBe(0);
    expect(f.fresh.railLabel).toContain("Scan");
  });

  it("has no heading, sub-line, Remove button, Add block, summary or disabled checkbox, and an accent-coloured checkbox", () => {
    expect(f.fresh.strays).toBe(0);
    expect(f.fresh.subLines).toBe(0);
    expect(
      f.fresh.rows.filter((r: Facts) => r.disabled).map((r: Facts) => r.key),
    ).toEqual([]);
    expect(f.fresh.rows.every((r: Facts) => r.accent === ACCENT)).toBe(true);
  });

  it("titles each row with its one-sentence description and prints nothing under it", () => {
    const title = (key: string) =>
      f.fresh.rows.find((r: Facts) => r.key === key).title;

    expect(title("structure")).toBe(
      "Finds import cycles, files nothing imports, unused exports, private imports, long or complex functions, duplication and policy violations. Runs with every scan and needs no tests.",
    );
    expect(title("describe")).toBe(
      "Writes one line per file saying what it is responsible for.",
    );
    expect(title("crap")).toBe(
      "C.R.A.P.: Change Risk Anti-Patterns. Runs the tests with coverage.",
    );
    expect(title("tally")).toBe("Runs tally.");
  });

  it("wraps a long status inside the panel's content box and keeps the tip inside the window", () => {
    expect(f.long.stateRight).toBeLessThanOrEqual(f.long.contentRight + 0.5);
    expect(f.long.lines).toBe(1);
    expect(f.long.nameOverflow).toBe(false);
    expect(f.long.tip.left).toBeGreaterThanOrEqual(0);
    expect(f.long.tip.top).toBeGreaterThanOrEqual(0);
    expect(f.long.tip.right).toBeLessThanOrEqual(f.long.viewport.w);
    expect(f.long.tip.bottom).toBeLessThanOrEqual(f.long.viewport.h);
  });

  it("matches the mock after a scan: Scanned with an age and no sha or counts", () => {
    expect(f.scanned.header).toBe("Ran just now");
    expect(f.scanned.amber).toBeNull();
  });

  it("lists Descriptions and the third-party rows, none disabled, when the installed list is unavailable", () => {
    expect(f.down).toEqual([
      { name: "Structural analysis", disabled: false },
      { name: "Descriptions", disabled: false },
      { name: "alpha", disabled: false },
      { name: "beta", disabled: false },
      { name: "tally", disabled: false },
      { name: "crap", disabled: false },
      { name: "mutation", disabled: false },
    ]);
  });

  it("shows each distinct settings-error reason once, wrapped inside the panel", () => {
    expect(f.settingsError.label).toBe("settings error");
    expect(f.settingsError.occurrences).toBe(1);
    expect(f.settingsError.fitsRight).toBe(true);
    expect(f.settingsError.unclipped).toBe(true);
    expect(f.settingsError.belowLabel).toBe(true);
  });

  it("lists a report after the list with no checkbox, its age and short commit, and a Clear button that deletes it", () => {
    expect(f.report.names).toEqual(NAMES);
    expect(f.report.listCount).toBe(7);
    expect(f.report.ticks).toBe(0);
    expect(f.report.chip).toBe("reported 3 minutes ago");
    expect(f.report.commit).toBe("feed123");
    expect(f.report.clear).toBe("Clear");
    expect(f.report.afterList).toBe(true);
    expect(f.reportCleared.removed).toEqual(["review"]);
    expect(f.reportCleared.present).toBe(false);
  });
});
