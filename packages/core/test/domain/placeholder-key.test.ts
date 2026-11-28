import { describe, expect, it } from "vitest";
import { PlaceholderKey } from "../../src/index.js";

describe("PlaceholderKey", () => {
  it("finds_every_placeholder_in_a_key", () => {
    const key = new PlaceholderKey("<metric>.<name>.above");

    expect(key.names()).toEqual(["metric", "name"]);
    expect(key.first()).toBe("metric");
    expect(new PlaceholderKey("threshold").names()).toEqual([]);
    expect(new PlaceholderKey("threshold").first()).toBeUndefined();
  });

  it("an_unanchored_placeholder_is_still_a_placeholder", () => {
    expect(PlaceholderKey.looksLikePlaceholder("a<b>")).toBe(true);
    expect(PlaceholderKey.looksLikePlaceholder("<B>")).toBe(false);
    expect(PlaceholderKey.looksLikePlaceholder("plain")).toBe(false);
  });
});
