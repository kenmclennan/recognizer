import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { Language, Parser } from "web-tree-sitter";
import {
  File,
  type Grammar,
  type GrammarRule,
  type Member,
  type Parsers,
  Repository,
  type Say,
} from "../../src/index.js";
import { createFakes, type Fakes } from "../fakes/container.js";
import { FakeParsing } from "../fakes/fake-parsing.js";
import { FIXTURE_LANGUAGES } from "../fakes/fixture-languages.js";

export const ROOT = "/repo";

const REPO = (() => {
  let directory = import.meta.dirname;

  while (!readdirSync(directory).includes("fixtures")) {
    directory = dirname(directory);
  }

  return directory;
})();

const GRAMMARS = join(REPO, "packages", "cli", "grammars");

const LANGUAGE_BY_SUFFIX: Record<string, string> = {
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".kt": "kotlin",
  ".rs": "rust",
  ".cs": "csharp",
};

const SELECTION = {
  extensions: [],
  skipDirectoryNames: [],
  skipDirectoryPrefixes: [],
  skipDirectorySuffixes: [],
  skipDirectoriesContaining: [],
  skipFileGlobs: [],
};

export const GRAMMAR_RULES: GrammarRule[] = (
  FIXTURE_LANGUAGES as unknown as { grammars: GrammarRule[] }[]
).flatMap((language) =>
  language.grammars.map((rule) => ({
    ...rule,
    function_names: rule.function_names ?? [],
    span: rule.span ?? null,
    vocabulary: rule.vocabulary ?? null,
  })),
);

export const EQUIVALENCE = join(REPO, "fixtures/duplication/equivalence");

export const FIXTURES = join(REPO, "fixtures");

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function readFixture(path: string): string {
  return readFileSync(join(REPO, path), "utf8");
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

export function scansOf(
  files: Record<string, string>,
  members: Record<string, Member[]> = {},
): Repository {
  const byLanguage = new Map<string, string[]>();

  for (const path of Object.keys(files).sort()) {
    const language = LANGUAGE_BY_SUFFIX[path.slice(path.lastIndexOf("."))];

    if (language !== undefined) {
      byLanguage.set(language, [...(byLanguage.get(language) ?? []), path]);
    }
  }

  const hash = "0".repeat(64);

  return Repository.of({
    files: [...byLanguage].flatMap(([language, paths]) =>
      paths.map(
        (path) =>
          new File({
            path,
            language,
            kind: "source",
            hash,
            members: members[path] ?? [],
            entryPoint: false,
            annotations: [],
            actualOf: [],
          }),
      ),
    ),
    extractions: [...byLanguage].map(([language, paths]) => ({
      language,
      scanner: { name: language, version: "0" },
      commit: "c1",
      modified: false,
      selection: SELECTION,
      files: paths.map((path) => ({ path, hash })),
    })),
  });
}

export interface Measured {
  fakes: Fakes;
  scans: Repository;
  say: Say;
  out: string[];
  err: string[];
}

export function measuredSources(
  texts: Record<string, string>,
  members: Record<string, Member[]> = {},
): Measured {
  const fakes = createFakes();
  const out: string[] = [];
  const err: string[] = [];

  for (const [path, text] of Object.entries(texts)) {
    fakes.source.files.set(`${ROOT}/${path}`, text);
  }

  return {
    fakes,
    scans: scansOf(texts, members),
    out,
    err,
    say: (stream, text) => (stream === "stderr" ? err : out).push(text),
  };
}

export function measuredFixture(directory: string): Measured {
  const base = join(REPO, directory);
  const texts: Record<string, string> = {};

  for (const file of filesUnder(base)) {
    texts[relative(base, file).split("\\").join("/")] = readFileSync(
      file,
      "utf8",
    );
  }

  return measuredSources(texts);
}

async function loadGrammars(grammars: readonly Grammar[]): Promise<Parsers> {
  await Parser.init();

  const parsers = new Map<Grammar, Parser>();

  for (const grammar of new Set(grammars)) {
    const parser = new Parser();

    parser.setLanguage(await Language.load(join(GRAMMARS, `${grammar}.wasm`)));
    parsers.set(grammar, parser);
  }

  return parsers;
}

export async function allParsers(): Promise<Parsers> {
  const parsing = new FakeParsing();

  parsing.parsers = await loadGrammars([
    "python",
    "typescript",
    "tsx",
    "kotlin",
    "rust",
    "csharp",
  ]);

  return parsing.loadParsers([...parsing.parsers.keys()]);
}
