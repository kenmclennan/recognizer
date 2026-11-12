import { describe, expect, it } from "vitest";
import { findKey, publish } from "../src/config-keys.js";
import { POLICY_KEYS } from "../src/policy-keys.js";

describe("the policy keys", () => {
  it("publish without two keys colliding", () => {
    expect(() => publish([POLICY_KEYS], "policy")).not.toThrow();
  });

  it.each([
    ["components", "a.b"],
    ["components", "a b"],
    ["uses", "a.b"],
    ["uses", "a b"],
    ["foreign", "a.b"],
    ["foreign", "a b"],
  ])("refuses %s.%s as not a valid <name>", (section, name) => {
    const published = publish([POLICY_KEYS], "policy");
    const typed = name.includes(".")
      ? [section, ...name.split(".")]
      : [section, name];
    const found = findKey(published, typed);

    expect("reason" in found).toBe(true);

    if (name.includes(" ")) {
      expect((found as { reason: string }).reason).toContain(
        "is not a valid <name>",
      );
    }
  });

  it("accepts a one-segment name", () => {
    const published = publish([POLICY_KEYS], "policy");

    expect("found" in findKey(published, ["components", "domain"])).toBe(true);
  });
});
