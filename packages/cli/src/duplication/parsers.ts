import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Parser } from "web-tree-sitter";
import { type Grammar, LANGUAGE_GRAMMARS } from "./grammars.js";

export type Parsers = ReadonlyMap<Grammar, Parser>;

export const GRAMMAR_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "grammars",
);

export async function loadParsers(
  languages: readonly string[],
  directory: string = GRAMMAR_DIRECTORY,
): Promise<Parsers> {
  const wanted = [
    ...new Set(
      languages.flatMap((language) => LANGUAGE_GRAMMARS[language] ?? []),
    ),
  ];
  const parsers = new Map<Grammar, Parser>();

  if (wanted.length === 0) {
    return parsers;
  }

  const { Language, Parser } = await import("web-tree-sitter");

  await Parser.init();

  for (const grammar of wanted) {
    const parser = new Parser();

    parser.setLanguage(await Language.load(join(directory, `${grammar}.wasm`)));
    parsers.set(grammar, parser);
  }

  return parsers;
}
