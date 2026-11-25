import { describe, expect, it } from "vitest";
import {
  analysisState,
  describeState,
  type ResultInput,
  runningState,
  scanState,
  sensorState,
  structureChanged,
} from "../../src/index.js";

function input(over: Partial<ResultInput> = {}): ResultInput {
  return {
    scan: { scannedAt: 5, changes: { files: [], moved: null } },
    sensors: [],
    lines: { of: () => ({ kind: "current" }) },
    describedAt: 9,
    run: { running: [], failures: {}, ranAt: {} },
    scanning: false,
    ...over,
  };
}

describe("result state", () => {
  it("a scan with changed files in scope is out of date for those files", () => {
    const given = input({
      scan: { scannedAt: 5, changes: { files: [{ path: "a" }], moved: null } },
    });

    expect(structureChanged(given, ["a", "b"])).toEqual(["a"]);
    expect(scanState(given, ["a", "b"])).toEqual({
      kind: "out-of-date",
      modules: ["a"],
    });
  });

  it("a moved scan changes every module in scope", () => {
    const given = input({
      scan: { scannedAt: 5, changes: { files: [], moved: {} } },
    });

    expect(structureChanged(given, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("a sensor that never ran reads never-run and one that ran reads current", () => {
    const gaps = new Map<string, string[]>();

    expect(sensorState("crap", input(), ["a"], gaps)).toEqual({
      kind: "never-run",
    });
    expect(
      sensorState(
        "crap",
        input({ sensors: [{ name: "crap", status: "ran", modifiedMs: 7 }] }),
        ["a"],
        gaps,
      ),
    ).toEqual({ kind: "current", at: 7 });
  });

  it("a sensor with a planned gap is out of date for the gap", () => {
    const gaps = new Map<string, string[]>();
    const given = input({
      freshness: {},
      sensors: [{ name: "crap", status: "ran", modifiedMs: 7 }],
      plan: { view: { gaps: { crap: ["a"] }, never: [] } },
    });

    expect(sensorState("crap", given, ["a", "b"], gaps)).toEqual({
      kind: "out-of-date",
      modules: ["a"],
    });
    expect(gaps.get("crap")).toEqual(["a"]);
  });

  it("a recorded failure reads failed with the time it ran", () => {
    const given = input({
      run: { running: [], failures: { crap: "boom" }, ranAt: { crap: 3 } },
    });

    expect(sensorState("crap", given, [], new Map())).toEqual({
      kind: "failed",
      at: 3,
    });
  });

  it("a running sensor carries the reported progress", () => {
    const given = input({
      scanning: true,
      run: { running: ["crap"], failures: {}, ranAt: {} },
      sensorProgress: { name: "crap", progress: { done: 2, total: 4 } },
    });

    expect(runningState("crap", given)).toEqual({
      kind: "running",
      done: 2,
      total: 4,
    });
  });

  it("descriptions with nothing described read never-run", () => {
    const given = input({ lines: { of: () => ({ kind: "none" }) } });

    expect(describeState(given, ["a"], new Map())).toEqual({
      kind: "never-run",
    });
  });

  it("structural analysis from another commit is out of date", () => {
    const given = input({
      sensors: [
        { name: "structure", status: "ran", commit: "old", modified: false },
      ],
      plan: { view: { gaps: {}, never: [] } },
      scansCommit: { commit: "new", modified: false },
    });

    expect(analysisState(given, ["a"])).toEqual({
      kind: "out-of-date",
      modules: ["a"],
    });
  });
});
