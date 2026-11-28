import { describe, expect, it } from "vitest";
import { PlaceholderSet } from "../../src/index.js";

describe("PlaceholderSet", () => {
  it("does_not_compile_a_broken_pattern_and_does_not_throw", () => {
    const set = new PlaceholderSet({
      bad: { pattern: "(", description: "broken" },
      good: { pattern: "^a+$", description: "fine" },
    });

    expect(set.pattern("bad")).toBeNull();
    expect(set.uncompilable()).toEqual(["bad"]);
    expect(set.pattern("good")?.test("aa")).toBe(true);
    expect(set.pattern("missing")).toBeNull();
    expect(set.names()).toEqual(["bad", "good"]);
    expect(set.has("good")).toBe(true);
    expect(set.has("missing")).toBe(false);
  });

  it("matches_a_values_declaration_exactly", () => {
    const pattern = new PlaceholderSet({
      mode: { values: ["a.b", "c"], description: "modes" },
    }).pattern("mode");

    expect(pattern?.test("a.b")).toBe(true);
    expect(pattern?.test("aXb")).toBe(false);
    expect(pattern?.test("c-extra")).toBe(false);
  });

  it("an_empty_set_declares_nothing", () => {
    const set = new PlaceholderSet();

    expect(set.names()).toEqual([]);
    expect(set.uncompilable()).toEqual([]);
  });
});
