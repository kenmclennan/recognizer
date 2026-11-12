import { describe, expect, it } from "vitest";
import { functionLength, LONG_FUNCTION } from "../src/function-length.js";

describe("functionLength", () => {
  it("counts the first and the last line", () => {
    expect(functionLength(1, 20)).toBe(20);
    expect(functionLength(5, 5)).toBe(1);
  });

  it("is unknown without an end line or when it precedes the start", () => {
    expect(functionLength(9, 3)).toBeNull();
    expect(functionLength(1, undefined)).toBeNull();
  });

  it("limits a long function at 20", () => {
    expect(LONG_FUNCTION).toBe(20);
  });
});
