import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Grammar, Parsers, Parsing } from "@recognizer/core";
import type { Parser } from "web-tree-sitter";

export const GRAMMAR_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "grammars",
);

export async function loadParsers(
  grammars: readonly string[],
  directory: string = GRAMMAR_DIRECTORY,
): Promise<Parsers> {
  const wanted = [...new Set(grammars)];
  const parsers = new Map<Grammar, Parser>();

  if (wanted.length === 0) {
    return parsers;
  }

  for (const grammar of wanted) {
    if (!existsSync(join(directory, `${grammar}.wasm`))) {
      throw new Error(`no grammar named ${grammar} is vendored`);
    }
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

export class ParsingAdapter implements Parsing {
  loadParsers(grammars: readonly string[]): Promise<Parsers> {
    return loadParsers(grammars);
  }
}
