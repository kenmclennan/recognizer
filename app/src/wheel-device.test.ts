import { describe, expect, it } from "vitest";
import { classifyWheel } from "./wheel-device";

const wheel = (overrides: Partial<Parameters<typeof classifyWheel>[0]>) =>
  classifyWheel({
    deltaX: 0,
    deltaY: 3,
    deltaMode: 0,
    ctrlKey: false,
    ...overrides,
  });

describe("wheel device", () => {
  it("reads a ctrl-wheel as a pinch", () => {
    expect(wheel({ ctrlKey: true, deltaY: 120 })).toBe("pinch");
  });

  it("reads line and page modes as a mouse wheel", () => {
    expect(wheel({ deltaMode: 1, deltaY: 3 })).toBe("mouse-wheel");
    expect(wheel({ deltaMode: 2, deltaY: 1 })).toBe("mouse-wheel");
  });

  it("splits at a fixed step of 50", () => {
    expect(wheel({ deltaY: 49 })).toBe("trackpad-scroll");
    expect(wheel({ deltaY: 50 })).toBe("mouse-wheel");
    expect(wheel({ deltaY: -50 })).toBe("mouse-wheel");
  });

  it("reads a fractional step as a trackpad", () => {
    expect(wheel({ deltaY: 120.5 })).toBe("trackpad-scroll");
  });

  it("reads any horizontal movement as a trackpad", () => {
    expect(wheel({ deltaX: 1, deltaY: 120 })).toBe("trackpad-scroll");
    expect(wheel({ deltaX: 200, deltaY: 0 })).toBe("trackpad-scroll");
  });
});
