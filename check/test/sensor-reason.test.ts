import { describe, expect, it } from "vitest";
import {
  parseReasonLine,
  REASON_PREFIX,
  stripReason,
} from "../src/sensor-reason.js";

const GOOD = { code: "tool-missing", line: "x is not installed", fix: "get x" };

describe("sensor reason lines", () => {
  it("parses a valid line and rejects other text", () => {
    expect(parseReasonLine(`${REASON_PREFIX}${JSON.stringify(GOOD)}`)).toEqual(
      GOOD,
    );
    expect(parseReasonLine("plain")).toBeNull();
    expect(parseReasonLine(`${REASON_PREFIX}[]`)).toBeNull();
  });

  it("strips only valid reason lines", () => {
    const bad = `${REASON_PREFIX}{nope`;

    expect(
      stripReason(`${REASON_PREFIX}${JSON.stringify(GOOD)}\n${bad}\nlast`),
    ).toBe(`${bad}\nlast`);
  });

  it("accepts a suite on the diagnosis and rejects an empty one", () => {
    const named = { ...GOOD, suite: "unit" };

    expect(parseReasonLine(`${REASON_PREFIX}${JSON.stringify(named)}`)).toEqual(
      named,
    );
    expect(
      parseReasonLine(
        `${REASON_PREFIX}${JSON.stringify({ ...GOOD, suite: "" })}`,
      ),
    ).toBeNull();
  });
});
