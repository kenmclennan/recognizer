import { describe, expect, it } from "vitest";
import { applyFill, elapsedText } from "./setup-progress";

describe("the apply bar", () => {
  it("is done commands over all commands", () => {
    expect(applyFill(3, 1, 0, 2)).toBeCloseTo(1 / 3);
    expect(applyFill(3, 3, 2, 2)).toBe(1);
  });

  it("falls back to finished changes when no command event arrives", () => {
    expect(applyFill(null, 0, 1, 2)).toBe(0.5);
    expect(applyFill(0, 0, 1, 4)).toBe(0.25);
  });
});

describe("elapsed text", () => {
  it("shows one decimal second under a minute and minutes after", () => {
    expect(elapsedText(1234)).toBe("1.2s");
    expect(elapsedText(-5)).toBe("0.0s");
    expect(elapsedText(125000)).toBe("2m 5s");
  });
});
