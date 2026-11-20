import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findFunctions } from "../src/duplication/functions.js";
import { grammarFor } from "../src/duplication/grammars.js";
import { assignIdentities } from "../src/duplication/identity.js";
import { GRAMMAR_DIRECTORY, loadParsers } from "../src/duplication/parsers.js";
import { EQUIVALENCE, readJson } from "./duplication-helpers.js";
import { REPO } from "./helpers.js";

interface Row {
  module: string;
  name: string;
  start_line: number;
  identity: string;
}

const ROOTS = [
  "fixtures/duplication/corpus",
  "fixtures/duplication/sample",
  "fixtures/crap/corpus",
  "fixtures/duplication/equivalence/sources",
];

const EXTENSIONS: Record<string, string[]> = {
  python: [".py"],
  typescript: [".ts", ".tsx", ".js"],
  kotlin: [".kt"],
  rust: [".rs"],
  csharp: [".cs"],
};

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

function sourceFiles(language: string): string[] {
  return ROOTS.flatMap((root) =>
    filesUnder(join(REPO, root))
      .map((path) =>
        path
          .slice(REPO.length + 1)
          .split("\\")
          .join("/"),
      )
      .filter((path) =>
        (EXTENSIONS[language] as string[]).some((e) => path.endsWith(e)),
      ),
  ).sort();
}

describe("function finding and identity against the Python goldens", () => {
  for (const language of Object.keys(EXTENSIONS)) {
    it(`finds the same ${language} functions with the same ids`, async () => {
      const golden = readJson<Row[]>(
        `${EQUIVALENCE}/functions.${language}.json`,
      );
      const parsers = await loadParsers([language], GRAMMAR_DIRECTORY);
      const items: [string, string, number][] = [];

      for (const path of sourceFiles(language)) {
        const grammar = grammarFor(path);
        const tree = parsers
          .get(grammar as never)
          ?.parse(readFileSync(join(REPO, path), "utf8"));

        for (const found of findFunctions(
          tree?.rootNode as never,
          grammar as never,
        )) {
          items.push([path, found.qualified, found.node.startPosition.row + 1]);
        }
      }

      const identities = assignIdentities(items);
      const rows = items.map(([module, name, line], index) => ({
        module,
        name,
        start_line: line,
        identity: identities[index],
      }));

      expect(golden.length).toBeGreaterThan(20);
      expect(rows).toEqual(golden);
    });
  }

  it("suffixes duplicate names with their line", () => {
    const golden = readJson<Row[]>(`${EQUIVALENCE}/functions.python.json`);
    const gets = golden.filter((row) => row.name === "Store.get");

    expect(gets.map((row) => row.identity)).toEqual([
      `${gets[0]?.module}::Store.get@${gets[0]?.start_line}`,
      `${gets[1]?.module}::Store.get@${gets[1]?.start_line}`,
    ]);
  });

  it("names a TypeScript arrow bound to a variable, a C# arrow property and indexer, and a Rust generic impl", () => {
    const names = (language: string) =>
      readJson<Row[]>(`${EQUIVALENCE}/functions.${language}.json`).map(
        (row) => row.name,
      );

    expect(names("typescript")).toContain("total");
    expect(names("csharp")).toEqual(
      expect.arrayContaining(["Store.Total", "Store.this"]),
    );
    expect(names("rust")).toContain("Store.get");
  });
});
