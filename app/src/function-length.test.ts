import { LONG_FUNCTION as LIBRARY_LONG_FUNCTION } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  barPercent,
  functionLength,
  HUGE_FUNCTION,
  LONG_FUNCTION,
  lengthBand,
  lengthText,
} from "./function-length";

describe("shared limit", () => {
  it("is the library's", () => {
    expect(LONG_FUNCTION).toBe(LIBRARY_LONG_FUNCTION);
  });
});

describe("lengthBand", () => {
  it("is neutral up to the long edge, long up to the huge edge and huge beyond", () => {
    expect(lengthBand(1)).toBe("neutral");
    expect(lengthBand(LONG_FUNCTION)).toBe("neutral");
    expect(lengthBand(LONG_FUNCTION + 1)).toBe("long");
    expect(lengthBand(HUGE_FUNCTION)).toBe("long");
    expect(lengthBand(HUGE_FUNCTION + 1)).toBe("huge");
  });

  it("has the edges the glossary names", () => {
    expect([LONG_FUNCTION, HUGE_FUNCTION]).toEqual([20, 50]);
  });
});

describe("functionLength", () => {
  it("counts the first and the last line", () => {
    expect(functionLength(249, 296)).toBe(48);
    expect(functionLength(5, 5)).toBe(1);
  });

  it("is unknown without an end line or when it precedes the start", () => {
    expect(functionLength(5, undefined)).toBeNull();
    expect(functionLength(5, null)).toBeNull();
    expect(functionLength(undefined, 9)).toBeNull();
    expect(functionLength(5, 4)).toBeNull();
  });
});

describe("barPercent", () => {
  it("is full at the largest, floored at 6 percent and proportional between", () => {
    expect(barPercent(99, 99)).toBe(100);
    expect(barPercent(1, 99)).toBe(6);
    expect(barPercent(50, 100)).toBe(50);
  });

  it("never exceeds the track", () => {
    expect(barPercent(200, 100)).toBe(100);
  });
});

describe("lengthText", () => {
  it("says 1 line for one and N lines otherwise", () => {
    expect(lengthText(1)).toBe("1 line");
    expect(lengthText(21)).toBe("21 lines");
  });
});
