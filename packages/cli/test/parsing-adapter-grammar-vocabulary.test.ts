import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { GRAMMAR_DIRECTORY } from "../src/adapters/filesystem/parsing-adapter.js";
import { REPO } from "./helpers.js";

interface Grammar {
  name: string;
  [key: string]: unknown;
  vocabulary?: {
    fields?: { [role: string]: string };
    assignment_operators?: string[];
    [role: string]: unknown;
  };
}

const GRAMMARS: Grammar[] = (
  JSON.parse(
    readFileSync(join(REPO, "fixtures/plugins/languages.json"), "utf8"),
  ) as { grammars?: Grammar[] }[]
).flatMap((language) => language.grammars ?? []);

const NODE_TYPES = new Map<string, Set<string>>();
const FIELD_NAMES = new Map<string, Set<string>>();

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
      const language = await Language.load(
        join(GRAMMAR_DIRECTORY, `${grammar.name}.wasm`),
      );

      NODE_TYPES.set(grammar.name, typesOf(language));
      FIELD_NAMES.set(
        grammar.name,
        new Set(
          language.fields.filter((name): name is string => name !== null),
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

  it("every published field is a field of its grammar", () => {
    let published = 0;

    for (const grammar of GRAMMARS) {
      const known = FIELD_NAMES.get(grammar.name) as Set<string>;
      const fields = Object.values(grammar.vocabulary?.fields ?? {});

      published += fields.length;
      expect(
        fields.filter((name) => !known.has(name)),
        grammar.name,
      ).toEqual([]);
    }

    expect(published).toBeGreaterThan(0);
  });

  it("every published assignment operator is a node type of its grammar", () => {
    for (const grammar of GRAMMARS) {
      const known = NODE_TYPES.get(grammar.name) as Set<string>;
      const operators = grammar.vocabulary?.assignment_operators ?? [];

      expect(operators.length, grammar.name).toBeGreaterThan(0);
      expect(
        operators.filter((operator) => !known.has(operator)),
        grammar.name,
      ).toEqual([]);
    }
  });
});
