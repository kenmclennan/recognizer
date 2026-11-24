import { describe, expect, it } from "vitest";
import { type GrammarRule, grammarFor } from "../../src/index.js";

function rule(name: string, extensions: string[]): GrammarRule {
  return {
    name,
    extensions,
    function_types: [],
    scope_types: [],
    branch_types: [],
    boolean_operators: [],
    bound_function_types: [],
  };
}

describe("grammarFor", () => {
  const rules = [rule("toy", [".toy", ".tz"]), rule("other", [".tz", ".oth"])];

  it("returns the rule whose extension matches, lower-cased", () => {
    expect(grammarFor("a/b.TOY", rules)?.name).toBe("toy");
    expect(grammarFor("c.oth", rules)?.name).toBe("other");
  });

  it("returns null for an unknown extension or none", () => {
    expect(grammarFor("a.unknown", rules)).toBeNull();
    expect(grammarFor("Makefile", rules)).toBeNull();
    expect(grammarFor("a.toy", [])).toBeNull();
  });

  it("returns the first rule when two claim an extension", () => {
    expect(grammarFor("a.tz", rules)?.name).toBe("toy");
  });
});
