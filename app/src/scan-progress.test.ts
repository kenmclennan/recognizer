import { describe, expect, it } from "vitest";
import {
  failedCount,
  foldProgress,
  footerText,
  NO_PROGRESS,
  parseScanLine,
  type ScanProgress,
  showTarget,
  stoppedProgress,
} from "./scan-progress";

function fold(lines: object[], from: ScanProgress = NO_PROGRESS): ScanProgress {
  return lines.reduce<ScanProgress>((state, line) => {
    const event = parseScanLine(JSON.stringify(line));

    return event === null ? state : foldProgress(state, event);
  }, from);
}

const phase = (name: string, total: number) => ({
  event: "phase",
  phase: name,
  total,
});
const entry = (name: string, phaseName: string, reason?: string) => ({
  event: "entry",
  phase: phaseName,
  name,
  outcome: reason === undefined ? "ok" : "failed",
  ...(reason === undefined ? {} : { reason }),
});
const extractRun = {
  event: "phase",
  phase: "extract",
  state: "run",
  commit: "abc",
  reason: "dirty",
};
const extractCurrent = {
  event: "phase",
  phase: "extract",
  state: "current",
  commit: "abc",
};
const summary = { event: "summary" };

describe("parseScanLine", () => {
  it("ignores invalid JSON, unknown events and unknown phases", () => {
    expect(parseScanLine("not json")).toBeNull();
    expect(parseScanLine("[1]")).toBeNull();
    expect(parseScanLine('{"event":"other"}')).toBeNull();
    expect(
      parseScanLine('{"event":"phase","phase":"other","total":1}'),
    ).toBeNull();
    expect(
      parseScanLine(
        '{"event":"entry","phase":"other","name":"a","outcome":"ok"}',
      ),
    ).toBeNull();
    expect(
      parseScanLine(
        '{"event":"entry","phase":"sense","name":"a","outcome":"maybe"}',
      ),
    ).toBeNull();
  });

  it("reads the phase, entry and summary lines", () => {
    expect(parseScanLine(JSON.stringify(extractRun))).toEqual({
      event: "phase",
      phase: "extract",
      state: "run",
      commit: "abc",
    });
    expect(parseScanLine(JSON.stringify(entry("a", "sense", "bad")))).toEqual({
      event: "entry",
      phase: "sense",
      name: "a",
      outcome: "failed",
      reason: "bad",
    });
    expect(parseScanLine(JSON.stringify(summary))).toEqual({
      event: "summary",
    });
  });
});

describe("footerText while a scan runs", () => {
  it("reads Extracting for a running extraction and Scans current for a current one", () => {
    expect(footerText(fold([extractRun]))).toMatchObject({
      text: "Extracting",
      running: true,
    });
    expect(footerText(fold([extractCurrent]))).toMatchObject({
      text: "Scans current",
      running: true,
    });
  });

  it("counts described modules and sensors as entries land", () => {
    const describing = fold([
      extractCurrent,
      phase("describe", 2),
      entry("a.py", "describe"),
    ]);

    expect(footerText(describing).text).toBe("Describing 1 of 2");

    const sensing = fold(
      [phase("sense", 2), entry("alpha", "sense")],
      fold([extractCurrent, phase("describe", 1), entry("a.py", "describe")]),
    );

    expect(footerText(sensing).text).toBe("Sensors 1 of 2");
    expect(footerText(sensing).running).toBe(true);
  });

  it("ignores a phase line for a phase the app does not know", () => {
    expect(
      fold([extractRun, { event: "phase", phase: "other", total: 3 }]).describe,
    ).toBeNull();
  });
});

describe("the extraction settle point", () => {
  it("is the first describe or sense phase line", () => {
    expect(fold([extractRun]).extractSettled).toBe(false);
    expect(fold([extractRun, entry("python", "extract")]).extractSettled).toBe(
      false,
    );
    expect(fold([extractRun, phase("describe", 1)]).extractSettled).toBe(true);
    expect(fold([extractRun, phase("sense", 1)]).extractSettled).toBe(true);
  });

  it("is the summary when no later phase ran", () => {
    expect(fold([extractCurrent, summary]).extractSettled).toBe(true);
  });
});

describe("footerText after a scan", () => {
  it("says Scan done with what ran", () => {
    expect(footerText(fold([extractCurrent, summary]))).toMatchObject({
      text: "Scan done - scans current",
      running: false,
      failed: 0,
    });
    expect(
      footerText(
        fold([
          extractRun,
          phase("describe", 2),
          entry("a", "describe"),
          entry("b", "describe"),
          phase("sense", 1),
          entry("alpha", "sense"),
          summary,
        ]),
      ).text,
    ).toBe("Scan done - extracted, described 2, 1 sensor");
  });

  it("says Stopped with what had finished", () => {
    expect(footerText(stoppedProgress(fold([extractRun]))).text).toBe(
      "Stopped - extracted",
    );
    expect(footerText(stoppedProgress(NO_PROGRESS)).text).toBe("Stopped");
  });
});

describe("the same-reason rule", () => {
  const describeAll = (reasons: (string | undefined)[]) =>
    fold([
      extractCurrent,
      phase("describe", reasons.length),
      ...reasons.map((reason, index) =>
        entry(`m${index}.py`, "describe", reason),
      ),
      summary,
    ]);

  it("says the reason once when every entry of the phase failed with it", () => {
    const text = footerText(
      describeAll([
        "command not found",
        "command not found",
        "command not found",
      ]),
    );

    expect(text.text).toBe("Describe failed: command not found");
    expect(text.failed).toBe(3);
  });

  it("counts when only some entries failed", () => {
    expect(footerText(describeAll(["x", "x", undefined])).text).toBe(
      "2 failed",
    );
  });

  it("says the reason on the bound of a single entry failed", () => {
    expect(footerText(describeAll(["x"])).text).toBe("Describe failed: x");
  });

  it("counts when the reasons differ", () => {
    expect(footerText(describeAll(["a", "a", "b"])).text).toBe("3 failed");
  });

  it("says the sensors reason once for an all-failed sensor phase", () => {
    const state = fold([
      extractCurrent,
      phase("sense", 2),
      entry("alpha", "sense", "boom"),
      entry("beta", "sense", "boom"),
      summary,
    ]);

    expect(footerText(state).text).toBe("Sensors failed: boom");
  });

  it("sums the failures across phases", () => {
    const state = fold([
      extractCurrent,
      phase("describe", 1),
      entry("a.py", "describe", "x"),
      phase("sense", 1),
      entry("alpha", "sense", "y"),
      summary,
    ]);

    expect(footerText(state).text).toBe("2 failed");
    expect(failedCount(state)).toBe(2);
  });

  it("counts an extract failure in the total", () => {
    expect(
      footerText(
        fold([extractRun, entry("python", "extract", "boom"), summary]),
      ).text,
    ).toBe("1 failed");
  });
});

describe("showTarget", () => {
  it("targets the first failed module, which wins over a failed sensor", () => {
    const state = fold([
      extractCurrent,
      phase("describe", 2),
      entry("a.py", "describe", "x"),
      entry("b.py", "describe", "y"),
      phase("sense", 1),
      entry("alpha", "sense", "z"),
      summary,
    ]);

    expect(showTarget(state)).toEqual({
      kind: "module",
      id: "a.py",
      reason: "x",
    });
  });

  it("targets the failed sensor row when no module failed", () => {
    const state = fold([
      extractCurrent,
      phase("sense", 2),
      entry("alpha", "sense"),
      entry("beta", "sense", "z"),
      summary,
    ]);

    expect(showTarget(state)).toEqual({
      kind: "sensor",
      name: "beta",
      reason: "z",
    });
  });

  it("has no target for an extract-only failure or no failure", () => {
    expect(
      showTarget(
        fold([extractRun, entry("python", "extract", "boom"), summary]),
      ),
    ).toBeNull();
    expect(showTarget(fold([extractCurrent, summary]))).toBeNull();
  });
});
