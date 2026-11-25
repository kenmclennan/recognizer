import { describe, expect, it } from "vitest";
import { checksOf } from "../../src/application/configuration/internal/survey-facts.js";

const check = (name: string, display: string) => ({
  name,
  display,
  runs_tests: false,
});

describe("the setup survey's check order", () => {
  it("lists the two core entries, then sensors and describers together by display", () => {
    const checks = checksOf({}, false, {
      sensors: [check("z1", "Mid"), check("a1", "Zeta")],
      describers: [check("d1", "alpha")],
      keys: [],
    });

    expect(checks.map((one) => one.id)).toEqual([
      "structure",
      "analysis",
      "d1",
      "z1",
      "a1",
    ]);
  });

  it("orders a tie of display by name", () => {
    const checks = checksOf({}, false, {
      sensors: [check("b", "Same"), check("a", "same")],
      describers: [],
      keys: [],
    });

    expect(checks.slice(2).map((one) => one.id)).toEqual(["a", "b"]);
  });
});
