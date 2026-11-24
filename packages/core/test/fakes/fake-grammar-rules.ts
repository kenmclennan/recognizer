import type { GrammarRule, GrammarRules } from "../../src/index.js";

export class FakeGrammarRules implements GrammarRules {
  constructor(public given: GrammarRule[] = []) {}

  rules(): GrammarRule[] {
    return this.given;
  }
}
