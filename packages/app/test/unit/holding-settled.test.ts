import { describe, expect, it } from "vitest";
import { settledMessage } from "../../src/holding-settled";

describe("settledMessage", () => {
  it("replaces the holding view with a no-result message when the attached scan ends with no explorer", () => {
    expect(settledMessage(true, false)).toBe(
      "The scan ended and left no result to show",
    );
  });

  it("leaves the screen alone when an explorer is shown", () => {
    expect(settledMessage(true, true)).toBeNull();
  });

  it("shows nothing when no holding view was shown", () => {
    expect(settledMessage(false, false)).toBeNull();
  });
});
