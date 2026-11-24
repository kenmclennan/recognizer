import type { InstalledPlugin } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { GrammarRulesAdapter } from "../src/adapters/plugins/grammar-rules-adapter.js";

function grammar(name: string, vocabulary?: object) {
  return {
    name,
    extensions: [`.${name}`],
    function_types: [],
    scope_types: [],
    branch_types: [],
    boolean_operators: [],
    bound_function_types: [],
    ...(vocabulary === undefined ? {} : { vocabulary }),
  };
}

function scanner(name: string, grammars: object[]): InstalledPlugin {
  return {
    kind: "scanner",
    name,
    command: `recognizer-scan-${name}`,
    manifest: { languages: [{ name, grammars }] },
    judgement: "supported",
    schema: "current",
  } as unknown as InstalledPlugin;
}

describe("GrammarRulesAdapter vocabulary", () => {
  it("a grammar with a vocabulary yields it", () => {
    const vocabulary = {
      comment_markers: ["comment"],
      member_fields: [{ type: "dot" }],
    };
    const [rule] = new GrammarRulesAdapter(() => [
      scanner("a", [grammar("a", vocabulary)]),
    ]).rules();

    expect(rule?.vocabulary).toEqual(vocabulary);
  });

  it("a vocabulary with fields yields it", () => {
    const vocabulary = {
      fields: { name: "name", body: "body" },
      assignment_operators: ["="],
    };
    const rules = new GrammarRulesAdapter(() => [
      scanner("a", [grammar("a", vocabulary), grammar("b")]),
    ]).rules();

    expect(rules.map((rule) => rule.vocabulary)).toEqual([vocabulary, null]);
  });

  it("a grammar without one yields null", () => {
    const [rule] = new GrammarRulesAdapter(() => [
      scanner("a", [grammar("a")]),
    ]).rules();

    expect(rule?.vocabulary).toBeNull();
  });

  it("two scanners, one with a vocabulary", () => {
    const vocabulary = { literal_types: ["str"] };
    const rules = new GrammarRulesAdapter(() => [
      scanner("b", [grammar("b")]),
      scanner("a", [grammar("a", vocabulary)]),
    ]).rules();

    expect(rules.map((rule) => [rule.name, rule.vocabulary])).toEqual([
      ["a", vocabulary],
      ["b", null],
    ]);
  });
});
