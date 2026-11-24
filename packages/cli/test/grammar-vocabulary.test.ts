import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { GRAMMAR_DIRECTORY } from "../src/adapters/filesystem/parsing-adapter.js";
import { REPO } from "./helpers.js";

interface Grammar {
  name: string;
  [key: string]: unknown;
  vocabulary?: { [role: string]: unknown };
}

const GRAMMARS: Grammar[] = (
  JSON.parse(
    readFileSync(join(REPO, "fixtures/plugins/languages.json"), "utf8"),
  ) as { grammars?: Grammar[] }[]
).flatMap((language) => language.grammars ?? []);

const NODE_TYPES = new Map<string, Set<string>>();

function typesOf(language: Language): Set<string> {
  const names = new Set<string>();

  for (let id = 0; id < language.nodeTypeCount; id += 1) {
    const name = language.nodeTypeForId(id);

    if (name !== null) {
      names.add(name);
    }
  }

  return names;
}

function publishedTypes(grammar: Grammar): string[] {
  const vocabulary = grammar.vocabulary ?? {};
  const listed = Object.entries({ ...grammar, ...vocabulary })
    .filter(([key]) => key.endsWith("_types"))
    .flatMap(([, value]) => value as string[]);
  const entries = ["member_fields", "node_names"].flatMap((key) =>
    ((vocabulary[key] ?? []) as { type: string }[]).map((entry) => entry.type),
  );

  return [...listed, ...entries];
}

function suffixesOf(grammar: Grammar): string[] {
  const vocabulary = grammar.vocabulary ?? {};

  return [
    ...((vocabulary.literal_suffixes ?? []) as string[]),
    ...((vocabulary.identifier_suffixes ?? []) as string[]),
  ];
}

describe("every grammar's published vocabulary", () => {
  beforeAll(async () => {
    await Parser.init();

    for (const grammar of GRAMMARS) {
      NODE_TYPES.set(
        grammar.name,
        typesOf(
          await Language.load(join(GRAMMAR_DIRECTORY, `${grammar.name}.wasm`)),
        ),
      );
    }
  });

  it("covers the six grammars", () => {
    expect(GRAMMARS).toHaveLength(6);
  });

  it("every published node type is a node type of its grammar", () => {
    for (const grammar of GRAMMARS) {
      const known = NODE_TYPES.get(grammar.name) as Set<string>;
      const published = publishedTypes(grammar);

      expect(published.length).toBeGreaterThan(0);
      expect(
        published.filter((type) => !known.has(type)),
        grammar.name,
      ).toEqual([]);
    }
  });

  it("every published suffix matches a node type of its grammar", () => {
    for (const grammar of GRAMMARS) {
      const known = [...(NODE_TYPES.get(grammar.name) as Set<string>)].filter(
        (type) => !type.startsWith("_"),
      );

      for (const suffix of suffixesOf(grammar)) {
        expect(
          known.some((type) => type.endsWith(suffix)),
          `${grammar.name} ${suffix}`,
        ).toBe(true);
      }
    }
  });
});
