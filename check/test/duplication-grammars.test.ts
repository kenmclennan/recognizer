import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Grammar } from "../src/duplication/grammars.js";
import { GRAMMAR_DIRECTORY, loadParsers } from "../src/duplication/parsers.js";
import type { SyntaxNode } from "../src/duplication/syntax.js";
import { EQUIVALENCE, readJson } from "./duplication-helpers.js";
import { REPO } from "./helpers.js";

interface Histogram {
  file: string;
  grammar: Grammar;
  total: number;
  types: Record<string, number>;
}

const LANGUAGE_OF: Record<Grammar, string> = {
  python: "python",
  typescript: "typescript",
  tsx: "typescript",
  kotlin: "kotlin",
  rust: "rust",
  csharp: "csharp",
};

function histogram(root: SyntaxNode): Record<string, number> {
  const counts: Record<string, number> = {};
  const stack = [root];

  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    counts[node.type] = (counts[node.type] ?? 0) + 1;
    stack.push(...node.children.filter((c): c is SyntaxNode => c !== null));
  }

  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

describe("the vendored grammars", () => {
  for (const grammar of Object.keys(LANGUAGE_OF) as Grammar[]) {
    it(`parse ${grammar} into the node types py-tree-sitter finds`, async () => {
      const expected = readJson<Histogram>(
        `${EQUIVALENCE}/histogram.${grammar}.json`,
      );
      const parsers = await loadParsers(
        [LANGUAGE_OF[grammar]],
        GRAMMAR_DIRECTORY,
      );
      const tree = parsers
        .get(grammar)
        ?.parse(readFileSync(join(REPO, expected.file), "utf8"));

      expect(expected.total).toBeGreaterThan(100);
      expect(tree).not.toBeNull();

      const found = histogram(tree?.rootNode as SyntaxNode);

      expect(Object.values(found).reduce((a, b) => a + b, 0)).toBeGreaterThan(
        100,
      );
      expect(found).toEqual(expected.types);
    });
  }
});
