import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { webkit } from "../../src/look-page";
import {
  eachGroup,
  type Facts,
  GROUPS2B,
  RED,
  SHORT_AGE,
  scanPanelFacts,
} from "../scan-panel-look-root-support";

describe.skipIf(webkit === undefined)("the Scan panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = (await scanPanelFacts([...eachGroup(GROUPS2B)])).facts;
  }, scaledTimeout(900000));

  it("carries no amber phrase in the header with files changed, and says so in the summary and the Structure row", () => {
    expect(f.changedBefore.buttons[0].text).not.toBe("Update 1 file");
    expect(f.changed.header).toBe("Ran 2 hours ago");
    expect(f.changed.amber).toBeNull();
    expect(f.changed.summary).toMatchObject({
      shape: "attention",
      head: "Descriptions, C.R.A.P., Mutation, tally, alpha and beta have never run",
      bar: 0,
    });
    expect(f.changed.rows.find((r: Facts) => r.key === "structure").state).toBe(
      "2h",
    );
    expect(f.changed.buttons[0]).toEqual({
      text: "Update 1 file",
      disabled: false,
      spinner: 0,
    });
  });

  it("posts the failure and the scan start to the tray in order for a failed sensor", () => {
    expect(f.sensorFail.messages.map((m: Facts) => m.text)).toEqual([
      "tally failed: broke",
      "Scan started - tally",
    ]);
    expect(f.sensorFail.reasonLines).toBe(0);
  });

  it("shows a failed sensor row from the message's Show and opens the log from its Open log", () => {
    expect(f.sensorFail.footer.text).toBe("");
    expect(f.sensorFail.footer.buttons).toEqual(["bell"]);
    expect(f.sensorFail.messages).toEqual([
      { text: "tally failed: broke", actions: ["Show", "Open log"] },
      { text: "Scan started - tally", actions: [] },
    ]);
    expect(f.sensorFail.hiddenBefore).toBe(true);
    expect(f.sensorFail.panelOpen).toBe(true);
    expect(f.sensorFail.dot).toBe(true);
    expect(f.sensorFail.opened).toEqual([
      expect.stringMatching(/^\.recognizer\/cache\/log\/.+-scan\.json$/),
    ]);
  });

  it("leaves a failed sensor at failed with its age and a log link in red under a run card in the bad tone", () => {
    const row = f.failed.rows.find((r: Facts) => r.key === "tally");

    expect(row.state).toBe("failed, just now");
    expect(row.color).toBe(RED);
    expect(row.logLink).toBe("log");
    expect(f.failed.summary.shape).toBe("run-card");
    expect(f.failed.summary.tone).toBe("bad");
    expect(f.failed.summary.bar).toBe(0);
    expect(f.failed.amber).toBeNull();
  });

  it("says why each sensor could not run fully, one second line per mock state", () => {
    const r = f.reasons;

    expect(r.crapRed.state).toMatch(SHORT_AGE);
    expect(r.crapRed.tone).toBe("ok");
    expect(r.crapRed.why).toBe("3 tests failed, so coverage may read low.");
    expect(r.crapRed).toMatchObject({ beneath: false, log: "log" });
    expect(r.crapNoCov.state).toMatch(SHORT_AGE);
    expect(r.crapNoCov.why).toContain("cargo install cargo-llvm-cov");
    expect(r.crapNoCov).toMatchObject({ beneath: false, log: null });
    expect(r.crapNoRun.state).toMatch(/^failed/);
    expect(r.crapNoRun.tone).toBe("bad");
    expect(r.crapNoRun.why).toBe(
      "pytest is not in this repository's environment. Add it with uv add --dev pytest.",
    );
    expect(r.crapNoRun).toMatchObject({ beneath: false });
    expect(r.mutationRed.state).toMatch(/^failed/);
    expect(r.mutationRed.tone).toBe("bad");
    expect(r.mutationRed.why).toContain("tests/test_orders.py::test_refund");
    expect(r.mutationRed).toMatchObject({ beneath: false, log: "log" });
    expect(r.mutationNoCov.state).toMatch(/^failed/);
    expect(r.mutationNoCov).toMatchObject({ beneath: false });
  });

  it("keeps each second line inside its row and clear of the next row", () => {
    const r = f.reasons;

    for (const one of [
      r.crapRed,
      r.crapNoCov,
      r.crapNoRun,
      r.mutationRed,
      r.mutationNoCov,
    ]) {
      expect(one.beneath).toBe(false);
      expect(one.oneLine).toBe(true);
      expect(one.clear).not.toBe(false);
    }
  });

  it("opens the sensors' log through the editor and copies the bare fix", () => {
    expect(f.reasons.opened).toEqual([
      ".recognizer/cache/coverage/last-run.log",
    ]);
  });

  it("shows a refusal remembered from the run log after a restart, with its reason, Copy and Show log, and nothing else changes", () => {
    const r = f.restart;

    expect(r.refused.state).toMatch(/^failed/);
    expect(r.refused.tone).toBe("bad");
    expect(r.refused.why).toBeTruthy();
    expect(r.refused.log).toBe("log");
    expect(r.copy.why).toBeTruthy();
    expect(r.refused.beneath).toBe(false);

    for (const one of [r.okNewer, r.none, r.older, r.tie]) {
      expect(one.state).toMatch(SHORT_AGE);
      expect(one.why).toBeNull();
    }
  });

  it("shows failed and no second line for a failure with no diagnosis", () => {
    expect(f.reasons.plain.state).toMatch(/^failed/);
    expect(f.reasons.plain.why).toBeNull();
  });
});
