import type { GrammarRule } from "../../../domain/analysis/duplication/grammars.js";

export interface GrammarRules {
  rules(): GrammarRule[];
}
