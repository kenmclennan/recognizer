import type { LanguageRule } from "../../../domain/language-rule.js";

export interface PublishedLanguages {
  rules(): LanguageRule[];
}
