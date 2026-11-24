import { findKey, POLICY_KEYS, publish } from "@recognizer/core";
import { describe, expect, it } from "vitest";

describe("the policy keys", () => {
  it("publish without two keys colliding", () => {
    expect(() => publish([POLICY_KEYS], "policy")).not.toThrow();
  });

  it("has entry, forbid and ignore and no retired key", () => {
    const names = POLICY_KEYS.keys.map((key) => key.key);

    expect(names).toEqual(["entry", "forbid", "ignore"]);
    expect(names.join(" ")).not.toMatch(/components|levels|uses|foreign/);
    expect(POLICY_KEYS.sections).toEqual([]);
  });

  it("does not offer foreign as a key", () => {
    const published = publish([POLICY_KEYS], "policy");

    expect("found" in findKey(published, ["foreign", "http"])).toBe(false);
  });
});
