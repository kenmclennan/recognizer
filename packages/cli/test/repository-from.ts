import type { Repository } from "@recognizer/core";
import { joinRepositories } from "@recognizer/core";
import type { ScanDoc } from "../src/adapters/filesystem/scan-document-types.js";
import { assemble } from "../src/adapters/filesystem/scan-translator.js";
import { SCAN_SCHEMA_VERSION, validateScan } from "../src/scan.js";

const SELECTION = {
  extensions: [],
  skip_directory_names: [],
  skip_directory_prefixes: [],
  skip_directory_suffixes: [],
  skip_directories_containing: [],
  skip_file_globs: [],
};

type Loose = Record<string, unknown>;

function completed(document: unknown): Loose {
  const given = document as Loose;
  const modules = ((given.modules as Loose[] | undefined) ?? []).map(
    (module) => ({
      language: "python",
      kind: "module",
      members: [],
      ...module,
    }),
  );

  return {
    schema_version: SCAN_SCHEMA_VERSION,
    scanner: { name: "t", version: "0" },
    commit: null,
    modified: false,
    files: [],
    edges: [],
    foreign: [],
    ...given,
    selection: { ...SELECTION, ...((given.selection as Loose) ?? {}) },
    modules,
  };
}

function languageOf(document: Loose): string {
  const first = (document.modules as Loose[])[0];

  return (first?.language as string | undefined) ?? "python";
}

export function repositoryFrom(
  documents: unknown,
  language?: string,
): Repository {
  const list = Array.isArray(documents) ? documents : [documents];

  return joinRepositories(
    list.map((one) => {
      const document = completed(one);

      return assemble([
        {
          language: language ?? languageOf(document),
          document: document as unknown as ScanDoc,
        },
      ]);
    }),
  );
}

export function validatedRepository(document: unknown): Repository {
  return repositoryFrom(validateScan(document));
}
