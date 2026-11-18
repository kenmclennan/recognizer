import { describe, expect, it } from "vitest";
import { elapsedText } from "./setup-progress";

describe("elapsed text", () => {
  it("shows one decimal second under a minute and minutes after", () => {
    expect(elapsedText(1234)).toBe("1.2s");
    expect(elapsedText(-5)).toBe("0.0s");
    expect(elapsedText(125000)).toBe("2m 5s");
  });
});
