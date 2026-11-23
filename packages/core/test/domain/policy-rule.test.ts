import { describe, expect, it } from "vitest";
import {
  EntryRule,
  ForbidRule,
  IgnoreRule,
  InvalidEntity,
  PolicyRule,
} from "../../src/index.js";

describe("PolicyRule", () => {
  it("builds each form from its fields", () => {
    expect(
      PolicyRule.of({
        type: "forbid",
        pattern: "p",
        from: ["a/**"],
        to: ["b/**"],
      }),
    ).toBeInstanceOf(ForbidRule);
    expect(PolicyRule.of({ type: "ignore", glob: "x" })).toBeInstanceOf(
      IgnoreRule,
    );
    expect(PolicyRule.of({ type: "entry", glob: "x" })).toBeInstanceOf(
      EntryRule,
    );
  });

  it("a forbid rule forbids a from and to that both match", () => {
    const rule = new ForbidRule({ pattern: "p", from: ["a/**"], to: ["b/**"] });

    expect(rule.forbids("a/x.py", "b/y.py")).toBe(true);
    expect(rule.forbids("b/x.py", "a/y.py")).toBe(false);
    expect(rule.forbids("a/x.py", "a/y.py")).toBe(false);
  });

  it("an ignore rule ignores what its glob matches", () => {
    const rule = new IgnoreRule({ glob: "gen/**" });

    expect(rule.ignores("gen/a.py")).toBe(true);
    expect(rule.ignores("src/a.py")).toBe(false);
  });

  it("an entry rule marks what its glob matches", () => {
    const rule = new EntryRule({ glob: "main.py" });

    expect(rule.marks("main.py")).toBe(true);
    expect(rule.marks("other.py")).toBe(false);
  });

  it("sorts a list of rules by form", () => {
    const rules = [
      PolicyRule.of({ type: "ignore", glob: "i" }),
      PolicyRule.of({ type: "entry", glob: "e" }),
      PolicyRule.of({ type: "forbid", pattern: "p", from: ["a"], to: ["b"] }),
    ];

    expect(PolicyRule.ignores(rules)).toHaveLength(1);
    expect(PolicyRule.entries(rules)).toHaveLength(1);
    expect(PolicyRule.forbids(rules)).toHaveLength(1);
    expect(PolicyRule.forbids(null)).toEqual([]);
  });

  it("refuses a forbid rule with an empty pattern", () => {
    expect(
      () => new ForbidRule({ pattern: "", from: ["a"], to: ["b"] }),
    ).toThrow(InvalidEntity);
  });

  it("refuses a forbid rule without a from or a to", () => {
    expect(() => new ForbidRule({ pattern: "p", from: [], to: ["b"] })).toThrow(
      /at least one from and one to/,
    );
    expect(() => new ForbidRule({ pattern: "p", from: ["a"], to: [] })).toThrow(
      InvalidEntity,
    );
  });

  it("refuses an ignore or entry rule with an empty glob", () => {
    expect(() => new IgnoreRule({ glob: "" })).toThrow(InvalidEntity);
    expect(() => new EntryRule({ glob: "" })).toThrow(InvalidEntity);
  });
});
