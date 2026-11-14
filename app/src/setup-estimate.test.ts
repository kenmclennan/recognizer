import { describe, expect, it } from "vitest";
import {
  budgetFor,
  estimateText,
  MAX_BUDGET_USD,
  setupEstimate,
} from "./setup-estimate";

describe("the setup estimate", () => {
  it("gives the figures worked from the price table", () => {
    expect(setupEstimate("sonnet")).toEqual({
      lowUsd: 0.26,
      highUsd: 1.04,
      capUsd: 2.08,
    });
    expect(setupEstimate("haiku")).toEqual({
      lowUsd: 0.01,
      highUsd: 0.05,
      capUsd: 0.11,
    });
    expect(setupEstimate("opus")).toEqual({
      lowUsd: 0.52,
      highUsd: 2.08,
      capUsd: 4.16,
    });
  });

  it("names the family inside a longer model name", () => {
    expect(setupEstimate("claude-sonnet-5-5")?.capUsd).toBe(2.08);
  });

  it("gives no estimate and no cap for a model naming no family", () => {
    expect(setupEstimate("mystery")).toBeNull();
    expect(budgetFor("mystery")).toBeNull();
    expect(estimateText("mystery")).toContain("No estimate");
  });

  it("passes the cap as the budget only below the Rust bound", () => {
    expect(budgetFor("sonnet")).toBe(2.08);
    expect(MAX_BUDGET_USD).toBe(100);
  });

  it("words the line as typical, API-equivalent and never a subscription share", () => {
    const text = estimateText("sonnet");

    expect(text).toContain("Typical");
    expect(text).toContain("API-equivalent");
    expect(text).toContain("$0.26 to $1.04");
    expect(text).toContain("$2.08");
  });
});
