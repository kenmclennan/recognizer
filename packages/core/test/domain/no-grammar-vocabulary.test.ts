import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const core = resolve(here, "..", "..");
const repository = resolve(core, "..", "..");

const ANALYSIS = join(core, "src", "domain", "analysis");
const FOLDERS = [join(ANALYSIS, "duplication"), join(ANALYSIS, "complexity")];

const LISTS = [
  "function_types",
  "scope_types",
  "branch_types",
  "bound_function_types",
];

interface Grammar {
  [key: string]: unknown;
  vocabulary?: {
    member_fields?: { type: string }[];
    fields?: { [role: string]: string };
    assignment_operators?: string[];
    node_names?: { type: string }[];
    [role: string]: unknown;
  };
}

function typesIn(grammar: Grammar): string[] {
  const vocabulary = grammar.vocabulary ?? {};
  const listed = LISTS.flatMap((key) => (grammar[key] as string[]) ?? []);
  const roles = Object.entries(vocabulary).flatMap(([role, value]) =>
    role === "member_fields" || role === "node_names"
      ? (value as { type: string }[]).map((entry) => entry.type)
      : role === "fields" ||
          role === "assignment_operators" ||
          role === "return_keywords" ||
          role === "self_texts" ||
          role === "comment_markers" ||
          role.endsWith("_suffixes")
        ? []
        : (value as string[]),
  );

  return [...listed, ...roles];
}

function publishedTypes(): Set<string> {
  const languages = JSON.parse(
    readFileSync(join(repository, "fixtures/plugins/languages.json"), "utf8"),
  ) as { grammars?: Grammar[] }[];

  return new Set(
    languages.flatMap((language) => (language.grammars ?? []).flatMap(typesIn)),
  );
}

function publishedFields(): Set<string> {
  const languages = JSON.parse(
    readFileSync(join(repository, "fixtures/plugins/languages.json"), "utf8"),
  ) as { grammars?: Grammar[] }[];

  return new Set(
    languages.flatMap((language) =>
      (language.grammars ?? []).flatMap((grammar) => [
        ...Object.values(grammar.vocabulary?.fields ?? {}),
        ...(grammar.vocabulary?.assignment_operators ?? []),
      ]),
    ),
  );
}

function literalsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];

  for (const match of text.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
    const before = text.slice(0, match.index).trimEnd();

    if (/(?:from|import)$/.test(before)) {
      continue;
    }

    found.push(match[1] as string);
  }

  return found;
}

function sourceFiles(): string[] {
  return FOLDERS.flatMap((folder) =>
    readdirSync(folder)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => join(folder, name)),
  );
}

describe("core's duplication and complexity code", () => {
  it("names no published node type", () => {
    const published = publishedTypes();
    const literals = sourceFiles().flatMap((file) =>
      literalsOf(file).map((literal) => ({ file, literal })),
    );

    expect(published.size).toBeGreaterThan(0);
    expect(literals.length).toBeGreaterThan(0);
    expect(
      literals
        .filter((entry) => published.has(entry.literal))
        .map((entry) => `${entry.file}: ${entry.literal}`),
    ).toEqual([]);
  });

  it("names no published field name or assignment operator", () => {
    const published = publishedFields();
    const literals = sourceFiles().flatMap((file) =>
      literalsOf(file).map((literal) => ({ file, literal })),
    );

    expect(published.size).toBeGreaterThan(0);
    expect(literals.length).toBeGreaterThan(0);
    expect(
      literals
        .filter((entry) => published.has(entry.literal))
        .map((entry) => `${entry.file}: ${entry.literal}`),
    ).toEqual([]);
  });
});
