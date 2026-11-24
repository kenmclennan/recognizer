import type { Grammar } from "../../../domain/analysis/duplication/grammars.js";
import type { SyntaxParser } from "../../../domain/analysis/duplication/syntax.js";

export type Parsers = ReadonlyMap<Grammar, SyntaxParser>;

export interface Parsing {
  loadParsers(grammars: readonly string[]): Promise<Parsers>;
}
