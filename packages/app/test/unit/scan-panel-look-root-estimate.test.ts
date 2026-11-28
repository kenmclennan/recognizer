import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { webkit } from "../../src/look-page";
import {
  type Facts,
  GROUPS4,
  scanPanelFacts,
  states,
} from "../scan-panel-look-root-support";

describe.skipIf(webkit === undefined)("the Scan panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = (await scanPanelFacts([GROUPS4])).facts;
  }, scaledTimeout(900000));

  it("shows the unregistered summary and its fix lines after a run when nothing is registered", () => {
    expect(f.afterRunUnregistered.shape).toBe("unregistered");
    expect(f.afterRunUnregistered.button).toBe("Nothing to run");
    expect(f.afterRunUnregistered.fixLines).toBeGreaterThan(0);
  });

  it("reads Checking on the rows and the headline until the first plan answer arrives, then reads the real state", () => {
    for (const panel of [f.beforePlan, f.beforePlanAfterRun]) {
      expect(panel.summary.shape).toBe("checking");
      expect(panel.summary.head).toBe("Checking what is out of date");
      expect(panel.rows.find((r: Facts) => r.key === "structure").state).toBe(
        "checking",
      );
      expect(panel.rows.find((r: Facts) => r.key === "crap").state).toBe(
        "checking",
      );
    }

    expect(f.afterPlan.summary.shape).not.toBe("checking");
    expect(states(f.afterPlan)).not.toContain("checking");
  });

  it("shows the estimate line under the primary button with its breakdown on hover, and hides it when nothing is ticked", () => {
    expect(f.estimateTicked).not.toBeNull();
    expect(f.estimateTicked.exists).toBe(true);
    expect(f.estimateTicked.hidden).toBe(false);
    expect(f.estimateTicked.afterButtons).toBe(true);
    expect(f.estimateTicked.text).toBe("About 3 min");
    expect(f.estimateTicked.title).toBe(
      "Structural analysis: <1 min (last run)\nMutation: 3 min (2 functions at recent pace)",
    );
    expect(f.estimateUnticked.hidden).toBe(true);
  });

  it("reads Mutation as no estimate yet while the sensor's work answer is pending, and a figure after", () => {
    expect(f.estimatePending.hidden).toBe(false);
    expect(f.estimatePending.text).toBe(
      "Under a minute, plus Mutation: no estimate yet",
    );
    expect(f.estimatePending.title).toContain("Mutation: no estimate yet");
    expect(f.estimateTicked.text).toBe("About 3 min");
  });
});
