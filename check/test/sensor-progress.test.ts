import { describe, expect, it } from "vitest";
import { PROGRESS_PREFIX, parseProgressLine } from "../src/sensor-progress.js";

function line(value: unknown): string {
  return `${PROGRESS_PREFIX}${JSON.stringify(value)}`;
}

describe("parseProgressLine", () => {
  it("returns the suite on a coverage line and on a mutants line", () => {
    expect(
      parseProgressLine(line({ step: "coverage", suite: "unit" })),
    ).toEqual({
      step: "coverage",
      suite: "unit",
    });
    expect(
      parseProgressLine(
        line({ step: "mutants", suite: "unit", done: 11, total: 29 }),
      ),
    ).toEqual({ step: "mutants", suite: "unit", done: 11, total: 29 });
  });

  it("still reads a line without a suite", () => {
    expect(parseProgressLine(line({ step: "coverage" }))).toEqual({
      step: "coverage",
    });
    expect(
      parseProgressLine(line({ step: "mutants", done: 1, total: 2 })),
    ).toEqual({ step: "mutants", done: 1, total: 2 });
  });

  it("refuses an empty or non-string suite", () => {
    expect(parseProgressLine(line({ step: "coverage", suite: "" }))).toBeNull();
    expect(parseProgressLine(line({ step: "coverage", suite: 3 }))).toBeNull();
  });
});
