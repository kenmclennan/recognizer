import { type Extraction, File, Member, Repository } from "../../src/index.js";

const SELECTION = {
  extensions: [],
  skipDirectoryNames: [],
  skipDirectoryPrefixes: [],
  skipDirectorySuffixes: [],
  skipDirectoriesContaining: [],
  skipFileGlobs: [],
};

export function repositoryOf(
  files: Record<string, string>,
  withFunction: string[],
  language = "python",
): Repository {
  const members = [new Member({ name: "f", exported: true, kind: "function" })];

  return Repository.of({
    files: Object.entries(files).map(([path, hash]) =>
      fileOf(path, language, hash, withFunction.includes(path) ? members : []),
    ),
    extractions: [
      extractionOf(
        language,
        Object.entries(files).map(([path, hash]) => ({ path, hash })),
      ),
    ],
  });
}

export function repositoryFromFacts(
  document: {
    modules: { id: string; members?: Member[] }[];
    files?: { path: string; hash: string }[];
  },
  language: string,
): Repository {
  const hashes = new Map(
    (document.files ?? []).map(({ path, hash }) => [path, hash]),
  );

  return Repository.of({
    files: document.modules.map(({ id, members }) =>
      fileOf(id, language, hashes.get(id) ?? null, members ?? []),
    ),
    extractions: [extractionOf(language, document.files ?? [])],
  });
}

function fileOf(
  path: string,
  language: string,
  hash: string | null,
  members: readonly Member[],
): File {
  return new File({
    path,
    language,
    kind: "source",
    hash,
    members,
    entryPoint: false,
    annotations: [],
    actualOf: [],
  });
}

function extractionOf(
  language: string,
  files: { path: string; hash: string }[],
): Extraction {
  return {
    language,
    scanner: { name: "fake", version: "0" },
    commit: null,
    modified: null,
    selection: SELECTION,
    files,
  };
}
