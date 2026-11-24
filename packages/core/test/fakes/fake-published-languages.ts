import type { LanguageRule, PublishedLanguages } from "../../src/index.js";

export class FakePublishedLanguages implements PublishedLanguages {
  constructor(public given: LanguageRule[]) {}

  rules(): LanguageRule[] {
    return this.given;
  }
}
