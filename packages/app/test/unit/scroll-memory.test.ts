import { describe, expect, it } from "vitest";
import { clampOffset } from "../../src/scroll-memory";

describe("clampOffset", () => {
  it("keeps an offset the new content still reaches", () => {
    expect(clampOffset(120, 1000, 400)).toBe(120);
  });

  it("clamps an offset past the end of shorter content", () => {
    expect(clampOffset(500, 600, 400)).toBe(200);
  });

  it("gives zero when the content now fits without scrolling", () => {
    expect(clampOffset(500, 300, 400)).toBe(0);
  });
});
