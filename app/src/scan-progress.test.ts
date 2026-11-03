import { describe, expect, it } from "vitest";
import {
  foldProgress,
  NO_PROGRESS,
  parseScanLine,
  type ScanProgress,
  scanningText,
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

describe("scanningText", () => {
  const rows = [
    { key: "crap", display: "C.R.A.P." },
    { key: "duplication", display: "Duplication" },
  ];
  const led = [{ key: "describe", display: "Descriptions" }, ...rows];
  const midRun = fold([extractCurrent, phase("sense", 2)]);

  it("names the running row and its place in the plan", () => {
    expect(scanningText(rows, "crap", midRun)).toBe(
      "Scanning\u2026 C.R.A.P., 1 of 2",
    );
  });

  it("reaches the last row", () => {
    expect(scanningText(rows, "duplication", midRun)).toBe(
      "Scanning\u2026 Duplication, 2 of 2",
    );
  });

  it("says Scanning alone before any row has started", () => {
    expect(scanningText(rows, null, NO_PROGRESS)).toBe("Scanning\u2026");
  });

  it("counts the describe row first", () => {
    expect(scanningText(led, "describe", NO_PROGRESS)).toBe(
      "Scanning\u2026 Descriptions, 1 of 3",
    );
  });

  it("is null once the scan is done or stopped", () => {
    expect(scanningText(rows, "crap", fold([extractCurrent, summary]))).toBe(
      null,
    );
    expect(scanningText(rows, "crap", stoppedProgress(midRun))).toBe(null);
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

describe("the start event", () => {
  it("parses a sense start line and ignores any other phase's", () => {
    expect(
      parseScanLine('{"event":"start","phase":"sense","name":"crap"}'),
    ).toEqual({ event: "start", phase: "sense", name: "crap" });
    expect(
      parseScanLine('{"event":"start","phase":"describe","name":"x"}'),
    ).toBeNull();
  });

  it("leaves the folded progress unchanged", () => {
    expect(
      foldProgress(NO_PROGRESS, {
        event: "start",
        phase: "sense",
        name: "crap",
      }),
    ).toBe(NO_PROGRESS);
  });
});
