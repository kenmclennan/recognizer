import { describe, expect, it } from "vitest";
import { ageText } from "./footer-scan";

describe("ageText", () => {
  it("steps through minutes, hours and days", () => {
    expect(ageText(0, 60000)).toBe("1 minute ago");
    expect(ageText(0, 59 * 60000)).toBe("59 minutes ago");
    expect(ageText(0, 60 * 60000)).toBe("1 hour ago");
    expect(ageText(0, 25 * 3600000)).toBe("1 day ago");
    expect(ageText(0, 72 * 3600000)).toBe("3 days ago");
  });

  it("never goes negative", () => {
    expect(ageText(5000, 0)).toBe("just now");
  });
});
