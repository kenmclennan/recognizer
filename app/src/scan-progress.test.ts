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

  it("names the running sensor and its place among the sensors", () => {
    expect(scanningText(rows, "crap", midRun)).toBe(
      "Running C.R.A.P.\u2026 1 of 2",
    );
  });

  it("reaches the last sensor", () => {
    expect(scanningText(rows, "duplication", midRun)).toBe(
      "Running Duplication\u2026 2 of 2",
    );
  });

  it("leaves the describe row out of the sensor count", () => {
    expect(scanningText(led, "duplication", midRun)).toBe(
      "Running Duplication\u2026 2 of 2",
    );
  });

  it("says Scanning alone before any row has started", () => {
    expect(scanningText(rows, null, NO_PROGRESS)).toBe("Scanning\u2026");
  });

  it("counts modules at zero right after the describe phase line", () => {
    expect(
      scanningText(
        led,
        "describe",
        fold([extractCurrent, phase("describe", 40)]),
      ),
    ).toBe("Describing\u2026 0 of 40 modules");
  });

  it("counts finished modules as entries arrive", () => {
    const entries = Array.from({ length: 12 }, (_, at) =>
      entry(`m${at}`, "describe"),
    );

    expect(
      scanningText(
        led,
        "describe",
        fold([extractCurrent, phase("describe", 40), ...entries]),
      ),
    ).toBe("Describing\u2026 12 of 40 modules");
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

describe("sensor progress", () => {
  const rows = [
    { key: "crap", display: "Crap" },
    { key: "mutation", display: "Mutation" },
  ];
  const coverage = {
    event: "progress",
    phase: "sense",
    name: "mutation",
    step: "coverage",
  };
  const mutants = (done: number, total: number) => ({
    event: "progress",
    phase: "sense",
    name: "mutation",
    step: "mutants",
    done,
    total,
  });
  const start = (name: string) => ({ event: "start", phase: "sense", name });
  const running = fold([
    extractCurrent,
    phase("sense", 2),
    entry("crap", "sense"),
    start("mutation"),
  ]);

  it("parses both shapes", () => {
    expect(parseScanLine(JSON.stringify(coverage))).toEqual(coverage);
    expect(parseScanLine(JSON.stringify(mutants(153, 229)))).toEqual(
      mutants(153, 229),
    );
    expect(parseScanLine(JSON.stringify(mutants(0, 0)))).toEqual(mutants(0, 0));
  });

  it("rejects done above total, a negative or fractional count and a missing done", () => {
    expect(parseScanLine(JSON.stringify(mutants(3, 2)))).toBeNull();
    expect(parseScanLine(JSON.stringify(mutants(-1, 2)))).toBeNull();
    expect(parseScanLine(JSON.stringify(mutants(1.5, 2)))).toBeNull();
    expect(
      parseScanLine(JSON.stringify({ ...coverage, step: "mutants" })),
    ).toBeNull();
    expect(
      parseScanLine(JSON.stringify({ ...coverage, step: "later" })),
    ).toBeNull();
    expect(
      parseScanLine(JSON.stringify({ ...coverage, phase: "describe" })),
    ).toBeNull();
  });

  it("is stored on a progress line and cleared on the next start and on a sense entry", () => {
    const stored = fold([mutants(1, 2)], running);

    expect(stored.sensorProgress).toEqual({
      name: "mutation",
      step: "mutants",
      done: 1,
      total: 2,
    });
    expect(fold([start("other")], stored).sensorProgress).toBeNull();
    expect(
      fold([entry("mutation", "sense")], stored).sensorProgress,
    ).toBeNull();
  });

  it("shows measuring coverage, then the function count, with no estimate", () => {
    expect(scanningText(rows, "mutation", running)).toBe(
      "Running Mutation\u2026 2 of 2",
    );
    expect(scanningText(rows, "mutation", fold([coverage], running))).toBe(
      "Mutation: measuring coverage",
    );
    expect(
      scanningText(rows, "mutation", fold([mutants(153, 229)], running)),
    ).toBe("Mutation: 153 of 229 functions");
    expect(
      scanningText(rows, "mutation", fold([mutants(229, 229)], running)),
    ).toBe("Mutation: 229 of 229 functions");
  });

  it("ignores another sensor's stored progress", () => {
    expect(scanningText(rows, "crap", fold([coverage], running))).toBe(
      "Running Crap\u2026 1 of 2",
    );
  });
});

describe("the describe stop event", () => {
  const stopped = {
    event: "stopped",
    phase: "describe",
    cause: "limit",
    reason: "out of quota",
    described: 412,
    not_described: 1628,
    threshold: 4,
  };

  it("folds into the progress and leaves the entries alone", () => {
    const state = fold([
      phase("describe", 2040),
      entry("a.py", "describe"),
      stopped,
    ]);

    expect(state.describeStop).toEqual({
      cause: "limit",
      reason: "out of quota",
      described: 412,
      notDescribed: 1628,
      threshold: 4,
    });
    expect(state.describe?.entries).toHaveLength(1);
  });

  it("is ignored with an unknown cause or a missing count", () => {
    expect(
      parseScanLine(JSON.stringify({ ...stopped, cause: "other" })),
    ).toBeNull();
    expect(
      parseScanLine(JSON.stringify({ ...stopped, not_described: "many" })),
    ).toBeNull();
  });
});
