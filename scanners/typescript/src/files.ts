import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const SKIPPED_DIRECTORIES = [
  "node_modules",
  "dist",
  "build",
  "test",
  "tests",
  "__tests__",
];
const SKIPPED_DIRECTORY_PREFIXES = ["."];
const SKIPPED_FILE_GLOBS = ["*.d.ts", "*.test.*", "*.spec.*"];

export interface Selection {
  extensions: string[];
  skip_directory_names: string[];
  skip_directory_prefixes: string[];
  skip_directory_suffixes: string[];
  skip_directories_containing: string[];
  skip_file_globs: string[];
}

export function selection(): Selection {
  return {
    extensions: [...SOURCE_EXTENSIONS],
    skip_directory_names: [...SKIPPED_DIRECTORIES],
    skip_directory_prefixes: [...SKIPPED_DIRECTORY_PREFIXES],
    skip_directory_suffixes: [],
    skip_directories_containing: [],
    skip_file_globs: [...SKIPPED_FILE_GLOBS],
  };
}

function matchesGlob(name: string, glob: string): boolean {
  const pattern = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${pattern}$`).test(name);
}

export function isSkippedDirectory(name: string): boolean {
  return (
    SKIPPED_DIRECTORIES.includes(name) ||
    SKIPPED_DIRECTORY_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

export function isSourceFile(name: string): boolean {
  if (!SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return false;
  }

  return !SKIPPED_FILE_GLOBS.some((glob) => matchesGlob(name, glob));
}

export function listSourceFiles(root: string): string[] {
  const found: string[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!isSkippedDirectory(entry.name)) {
          walk(path);
        }
      } else if (entry.isFile() || isFileSymlink(entry, path)) {
        if (isSourceFile(entry.name)) {
          found.push(path);
        }
      }
    }
  };

  walk(root);

  return found;
}

function isFileSymlink(
  entry: { isSymbolicLink(): boolean },
  path: string,
): boolean {
  if (!entry.isSymbolicLink()) {
    return false;
  }

  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
