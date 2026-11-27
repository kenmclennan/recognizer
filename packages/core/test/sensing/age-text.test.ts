import { describe, expect, it } from "vitest";
import { ageText } from "../../src/index.js";

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("ageText", () => {
  it.each([
    [0, "just now"],
    [MINUTE - 1, "just now"],
    [MINUTE, "1 minute ago"],
    [2 * MINUTE, "2 minutes ago"],
    [HOUR - 1, "59 minutes ago"],
    [HOUR, "1 hour ago"],
    [DAY - 1, "23 hours ago"],
    [DAY, "1 day ago"],
    [3 * DAY, "3 days ago"],
  ])("reads %i ms in the long style as %s", (ms, text) => {
    expect(ageText(0, ms)).toBe(text);
    expect(ageText(0, ms, "long")).toBe(text);
  });

  it.each([
    [0, "now"],
    [MINUTE - 1, "now"],
    [MINUTE, "1m"],
    [HOUR - 1, "59m"],
    [HOUR, "1h"],
    [DAY - 1, "23h"],
    [DAY, "1d"],
    [3 * DAY, "3d"],
  ])("reads %i ms in the short style as %s", (ms, text) => {
    expect(ageText(0, ms, "short")).toBe(text);
  });

  it("never goes negative in either style", () => {
    expect(ageText(5000, 0)).toBe("just now");
    expect(ageText(5 * MINUTE, 0, "short")).toBe("now");
  });
});
