import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { GRAMMAR_DIRECTORY, loadParsers } from "../src/duplication/parsers.js";
import type { RecordedScan } from "../src/scan.js";
import { REPO } from "./helpers.js";
import { type Fake, fakeIo, ROOT } from "./scan-helpers.js";

const LANGUAGE_BY_SUFFIX: Record<
  string,
  RecordedScan["modules"][number]["language"]
> = {
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".kt": "kotlin",
  ".rs": "rust",
  ".cs": "csharp",
};

export const EQUIVALENCE = join(REPO, "fixtures/duplication/equivalence");

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

export interface Measured {
  fake: Fake;
  scans: RecordedScan[];
}

export function scansOf(files: Record<string, string>): RecordedScan[] {
  const byLanguage = new Map<string, string[]>();

  for (const path of Object.keys(files).sort()) {
    const language = LANGUAGE_BY_SUFFIX[path.slice(path.lastIndexOf("."))];

    if (language !== undefined) {
      byLanguage.set(language, [...(byLanguage.get(language) ?? []), path]);
    }
  }

  return [...byLanguage].map(
    ([language, paths]) =>
      ({
        scanner: { name: language, version: "0" },
        commit: "c1",
        modified: false,
        files: paths.map((path) => ({ path, hash: "0".repeat(64) })),
        selection: {},
        modules: paths.map((path) => ({
          id: path,
          language,
          kind: "module",
        })),
        edges: [],
        foreign: [],
      }) as unknown as RecordedScan,
  );
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

  const fake = fakeIo({
    files: Object.fromEntries(
      Object.entries(texts).map(([path, text]) => [`${ROOT}/${path}`, text]),
    ),
  });

  return { fake, scans: scansOf(texts) };
}

export function measuredSources(texts: Record<string, string>): Measured {
  const fake = fakeIo({
    files: Object.fromEntries(
      Object.entries(texts).map(([path, text]) => [`${ROOT}/${path}`, text]),
    ),
  });

  return { fake, scans: scansOf(texts) };
}

export async function allParsers() {
  return loadParsers(
    ["python", "typescript", "kotlin", "rust", "csharp"],
    GRAMMAR_DIRECTORY,
  );
}

export { ROOT };
