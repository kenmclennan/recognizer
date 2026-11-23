import type {
  Call,
  Dependency,
  Library,
  TestImport,
  UnresolvedImport,
} from "./dependency.js";
import type { Extraction } from "./extraction.js";
import type { File } from "./file.js";
import type { Folder } from "./folder.js";

export interface Repository {
  readonly folders: readonly Folder[];
  readonly files: readonly File[];
  readonly dependencies: readonly Dependency[];
  readonly libraries: readonly Library[];
  readonly calls: readonly Call[];
  readonly unresolvedImports: readonly UnresolvedImport[];
  readonly testImports: readonly TestImport[];
  readonly extractions: readonly Extraction[];
}

export const EMPTY_REPOSITORY: Repository = {
  folders: [],
  files: [],
  dependencies: [],
  libraries: [],
  calls: [],
  unresolvedImports: [],
  testImports: [],
  extractions: [],
};

export function joinRepositories(parts: readonly Repository[]): Repository {
  return {
    folders: parts.flatMap((part) => part.folders),
    files: parts.flatMap((part) => part.files),
    dependencies: parts.flatMap((part) => part.dependencies),
    libraries: parts.flatMap((part) => part.libraries),
    calls: parts.flatMap((part) => part.calls),
    unresolvedImports: parts.flatMap((part) => part.unresolvedImports),
    testImports: parts.flatMap((part) => part.testImports),
    extractions: parts.flatMap((part) => part.extractions),
  };
}

export function fileAt(repository: Repository, path: string): File | undefined {
  return repository.files.find((file) => file.path === path);
}

export function dependentsOf(
  repository: Repository,
  path: string,
): readonly Dependency[] {
  return repository.dependencies.filter((dependency) => dependency.to === path);
}

export function scannedHashes(repository: Repository): Map<string, string> {
  const hashes = new Map<string, string>();

  for (const extraction of repository.extractions) {
    for (const file of extraction.files) {
      hashes.set(file.path, file.hash);
    }
  }

  return hashes;
}
