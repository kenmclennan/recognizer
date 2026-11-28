import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { webkit } from "../../src/look-page";
import {
  type Facts,
  GROUPS2A,
  scanPanelFacts,
} from "../scan-panel-look-root-support";

describe.skipIf(webkit === undefined)("the Scan panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = (await scanPanelFacts([GROUPS2A])).facts;
  }, scaledTimeout(900000));

  it("offers the canvas and whole-repository switch on an Untitled canvas, captioned This canvas and sized by its open files", () => {
    expect(f.scopeNone.scope.switches).toBe(1);
    expect(f.scopeNone.scope.caption).toBe("This canvas, 0");
    expect(f.scopeNone.scope.all).toBe("Whole repository");
    expect(f.scopeUntitled.scope.caption).toMatch(/^This canvas, [1-9]/);
    expect(f.scopeUntitledOn.scope.on).toBe("true");
  });

  it("captions a saved view by name and locks the switch during a run", () => {
    expect(f.scopeOff.scope).toEqual({
      switches: 1,
      caption: "demo, 1",
      on: "false",
      all: "Whole repository",
      disabled: false,
    });
    expect(f.scopeOn.scope.on).toBe("true");
    expect(f.scopeRunning.disabled).toBe(true);
    expect(f.scopeRan.after.disabled).toBe(false);
  });

  it("reads Descriptions and a ticked Mutation row as never run under either scope and leaves the other rows alone", () => {
    expect(f.scopeOff.describe).toBe("never run");
    expect(f.scopeOff.mutation).toBe("never run");
    expect(f.scopeOn.describe).toBe("never run");
    expect(f.scopeOn.mutation).toBe("never run");
    expect(f.scopeOn.crap).toBe(f.scopeOff.crap);
    expect(f.scopeOn.duplication).toBe(f.scopeOff.duplication);
  });

  it("lays out the rows, then the scope toggle, the mode toggle, the primary, with the primary full width and nothing clipped", () => {
    expect(f.layout.order).toEqual([
      "scan-header",
      "scan-sub",
      "scan-list",
      "scan-controls",
      "scan-buttons",
      "scan-estimate",
    ]);
    expect(f.layout.controls).toEqual(["scan-scope", "scan-run-mode"]);
    expect(f.layout.rowsBeforeControls).toBe(true);
    expect(f.layout.scopeAboveMode).toBe(true);
    expect(f.layout.modeAbovePrimary).toBe(true);
    expect(
      Math.abs(f.layout.runWidth - f.layout.contentWidth),
    ).toBeLessThanOrEqual(1);
    expect(f.layout.modeClipped).toBe(false);
    expect(f.layout.secondaryCss).toBe(0);
  });

  it("disables This canvas with a tooltip at a count of 0 and plans the whole repository without rewriting the tick", () => {
    expect(f.emptyCanvas).toEqual({
      canvasDisabled: true,
      canvasTitle: "The canvas is empty.",
      canvasPressed: "false",
      allPressed: "true",
      allDisabled: false,
      caption: f.emptyCanvas.caption,
    });
    expect(f.emptyCanvasClick.writes).toBe(0);
    expect(f.emptyCanvasRun.modules).toEqual([null]);
    expect(f.emptyCanvasRun.onlyView).toBe(true);
  });

  it("runs nothing and writes no tick when the primary reads Ticked checks are up to date", () => {
    expect(f.idleButton.label).toBe("Ticked checks are up to date");
    expect(f.idleButton.disabled).toBe(true);
    expect(f.idleButton.text).not.toMatch(/include (it|them) in the next scan/);
    expect(f.idleClick).toEqual({ ran: 0, written: 0 });
  });

  it("remembers the switch through the port and sends the view's file ids when it is on, and a click on Run with the scope off runs the still-ticked sensor on the whole repository", () => {
    expect(f.scopeOn.written.onlyView).toBe(true);
    expect(f.scopeRan.modules).toEqual([["app/a.py"]]);
    expect(f.scopeOffRan).toEqual([["app/a.py"], ["app/a.py", "app/b.py"]]);
  });

  it("summarises one sensor-out-of-date file with no bar and Update 1 file, then everything current with a disabled Up to date once the hashes match", () => {
    expect(f.freshPartial.summary).toMatchObject({
      shape: "behind",
      tone: "warn",
      head: "C.R.A.P. is out of date on 1 file",
      bar: 0,
    });
    expect(f.freshPartial.rowBars).toBe(0);
    expect(f.freshPartial.rows).toEqual([
      { state: "1 file out of date", note: null },
    ]);
    expect(f.freshPartial.button).toBe("Update 1 file");
    expect(f.freshPartial.disabled).toBe(false);
    expect(f.freshPartial.secondary).toBe(0);
    expect(f.freshPartial.mode).toBe("Incremental");
    expect(f.freshPartial.oldSwitch).toBe(0);
    expect(f.freshComplete.summary).toMatchObject({
      shape: "current",
      tone: "ok",
      head: "Everything on the repository is current",
      bar: 0,
    });
    expect(f.freshComplete.rowBars).toBe(0);
    expect(f.freshComplete.button).toBe("Up to date");
    expect(f.freshComplete.disabled).toBe(true);
  });
});
