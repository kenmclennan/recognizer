import { describe, expect, it } from "vitest";
import {
  appSettingsProblem,
  describingProblem,
  setupProblem,
} from "../../src/index.js";

const describing = (over: Record<string, unknown> = {}) => ({
  model: "sonnet",
  batch_size: 4,
  ...over,
});

describe("app settings", () => {
  it("describing_rejects_bad_values_naming_the_key", () => {
    for (const bad of [
      3,
      { model: "-x", batch_size: 4 },
      { model: "a b", batch_size: 4 },
      { model: "", batch_size: 4 },
      describing({ batch_size: 0 }),
      describing({ batch_size: 17 }),
      describing({ batch_size: 2.5 }),
      describing({ batch_size: "4" }),
      describing({ confirm_above_usd: -1 }),
      describing({ confirm_above_usd: "5" }),
      describing({ confirm_above_usd: 10001 }),
      describing({ confirm_above_usd: null }),
    ]) {
      expect(describingProblem(bad), JSON.stringify(bad)).toContain(
        "describing",
      );
    }
  });

  it("describing_threshold_accepts_zero_and_the_maximum", () => {
    for (const amount of [0, 10000, 0.5]) {
      expect(
        describingProblem({
          model: "haiku",
          batch_size: 4,
          confirm_above_usd: amount,
        }),
      ).toBeNull();
    }
  });

  it("describing without a threshold reads five", () => {
    expect(describingProblem(describing())).toBeNull();
  });

  it("saving_rejects_a_bad_describing_and_writes_nothing", () => {
    const setup = { model: "sonnet" };

    expect(
      appSettingsProblem({
        describing: describing({ model: "a b" }),
        setup,
      }),
    ).toBe(
      "describing.model must be a non-empty name with no whitespace and no leading -",
    );
    expect(
      appSettingsProblem({ describing: describing({ batch_size: 17 }), setup }),
    ).toBe("describing.batch_size must be a whole number from 1 to 16");
    expect(
      appSettingsProblem({
        describing: describing({ confirm_above_usd: 10001 }),
        setup,
      }),
    ).toBe("describing.confirm_above_usd must be a number from 0 to 10000");
  });

  it("refuses a blank or dashed setup model", () => {
    for (const model of ["", "  ", "-x", "a b"]) {
      expect(setupProblem({ model })).toBe(
        "setup.model must be a non-empty name with no whitespace and no leading -",
      );
    }

    expect(setupProblem({ model: "sonnet" })).toBeNull();
  });
});
