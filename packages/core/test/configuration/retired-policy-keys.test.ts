import { describe, expect, it } from "vitest";
import { retiredPolicyKeysIn } from "../../src/index.js";

describe("retiredPolicyKeysIn", () => {
  it("returns the retired keys among those given", () => {
    expect(retiredPolicyKeysIn(["levels", "entry", "uses"])).toEqual([
      "levels",
      "uses",
    ]);
  });

  it("returns nothing for no keys", () => {
    expect(retiredPolicyKeysIn([])).toEqual([]);
  });

  it("returns nothing when no key is retired", () => {
    expect(retiredPolicyKeysIn(["entry"])).toEqual([]);
  });
});
