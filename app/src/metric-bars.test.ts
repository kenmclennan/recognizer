import { describe, expect, it } from "vitest";
import {
  BAR_BOTTOM_PAD,
  BAR_MIN_BOX_WIDTH,
  BAR_ROW,
  BAR_TRACK_HEIGHT,
  barRect,
  barTitle,
  barWidth,
  fraction,
  rangeLabel,
  tone,
  valueLabel,
} from "./metric-bars";

type Shape = Parameters<typeof tone>[0];

const count = (max: number, bad: "high" | "low" = "high"): Shape => ({
  type: "count",
  max,
  bad,
  label: "complexity",
});
const ratio = (bad: "high" | "low" = "low"): Shape => ({
  type: "ratio",
  max: 1,
  bad,
  label: "coverage",
});
const boolean = (bad: "high" | "low" = "high"): Shape => ({
  type: "boolean",
  max: 0,
  bad,
  label: "flag",
});

describe("fraction", () => {
  it("clamps a ratio, scales a count by max and handles max 0", () => {
    expect(fraction(ratio(), 0.25)).toBe(0.25);
    expect(fraction(ratio(), 1.5)).toBe(1);
    expect(fraction(ratio(), -1)).toBe(0);
    expect(fraction(count(8), 2)).toBe(0.25);
    expect(fraction(count(8), 20)).toBe(1);
    expect(fraction(count(0), 3)).toBe(0);
    expect(fraction({ ...count(10), type: "number" }, 2.5)).toBe(0.25);
  });

  it("fills a boolean fully for true and not at all for false", () => {
    expect(fraction(boolean(), true)).toBe(1);
    expect(fraction(boolean(), false)).toBe(0);
  });
});

describe("tone", () => {
  it("is exact at the thirds for a count", () => {
    expect(tone(count(3), 0)).toBe("green");
    expect(tone(count(3), 1)).toBe("amber");
    expect(tone(count(3), 2)).toBe("red");
    expect(tone(count(3), 3)).toBe("red");
  });

  it("mirrors for bad low", () => {
    expect(tone(count(3, "low"), 1)).toBe("red");
    expect(tone(count(3, "low"), 2)).toBe("amber");
    expect(tone(count(3, "low"), 3)).toBe("green");
  });

  it("is exact at the thirds for a ratio from integer-safe inputs", () => {
    expect(tone(ratio("high"), 1 / 3)).toBe("amber");
    expect(tone(ratio("high"), 2 / 3)).toBe("red");
    expect(tone(ratio("high"), 0.3)).toBe("green");
    expect(tone(ratio("low"), 1 / 3)).toBe("red");
    expect(tone(ratio("low"), 2 / 3)).toBe("amber");
    expect(tone(ratio("low"), 1)).toBe("green");
  });

  it("follows bad for a boolean", () => {
    expect(tone(boolean("high"), true)).toBe("red");
    expect(tone(boolean("high"), false)).toBe("green");
    expect(tone(boolean("low"), true)).toBe("green");
  });

  it("colours the worked example: coverage 0.1818 with bad low is red", () => {
    expect(tone(ratio("low"), 0.1818)).toBe("red");
    expect(tone(count(8), 8)).toBe("red");
    expect(tone(count(8), 1)).toBe("green");
  });
});

describe("labels", () => {
  it("formats each value type", () => {
    expect(valueLabel(ratio(), 0.1818)).toBe("18%");
    expect(valueLabel(count(3), 1)).toBe("1");
    expect(valueLabel({ ...count(3), type: "number" }, 43.053)).toBe("43.1");
    expect(valueLabel({ ...count(3), type: "number" }, 2)).toBe("2");
    expect(valueLabel(boolean(), true)).toBe("yes");
    expect(valueLabel(boolean(), false)).toBe("no");
  });

  it("words the range and the bad end", () => {
    expect(rangeLabel(ratio("low"))).toBe("0 to 100%, low is bad");
    expect(rangeLabel(count(8))).toBe("0 to 8, high is bad");
    expect(rangeLabel(boolean())).toBe("no or yes, high is bad");
  });

  it("titles module, member and unknown bars", () => {
    expect(barTitle(count(8), { value: 8, member: "classify" })).toBe(
      "complexity 8, worst: classify",
    );
    expect(barTitle(ratio(), { value: 0.1818, member: null })).toBe(
      "coverage 18%",
    );
    expect(barTitle(count(8), null)).toBe("complexity: not measured");
  });
});

describe("geometry", () => {
  const rect = {
    x: 100,
    y: 200,
    width: 160,
    height: 40 + 2 * BAR_ROW + BAR_BOTTOM_PAD,
  };

  it("places each track in its own row below the base", () => {
    const first = barRect(rect, 40, 0);
    const second = barRect(rect, 40, 1);

    expect(first.x).toBe(144);
    expect(first.height).toBe(BAR_TRACK_HEIGHT);
    expect(second.y - first.y).toBe(BAR_ROW);
    expect(first.y).toBeGreaterThanOrEqual(240);
    expect(second.y + second.height).toBeLessThanOrEqual(rect.y + rect.height);
    expect(first.x + first.width).toBeLessThan(rect.x + rect.width);
  });

  it("widens a box with bars to the minimum and never narrows a wider one", () => {
    expect(barWidth(96, 1)).toBe(BAR_MIN_BOX_WIDTH);
    expect(barWidth(BAR_MIN_BOX_WIDTH, 1)).toBe(BAR_MIN_BOX_WIDTH);
    expect(barWidth(200, 2)).toBe(200);
    expect(barWidth(96, 0)).toBe(96);
  });
});
