import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
];
const SKIPPED_DIRECTORIES = [
  "node_modules",
  "dist",
  "build",
  "test",
  "tests",
  "__tests__",
];
const SKIPPED_DIRECTORY_PREFIXES = ["."];
const SKIPPED_FILE_GLOBS = [
  "*.d.ts",
  "*.d.mts",
  "*.d.cts",
  "*.test.*",
  "*.spec.*",
];
const DECLARATION_GLOBS = ["*.d.ts", "*.d.mts", "*.d.cts"];
const TEST_DIRECTORIES = ["test", "tests", "__tests__"];
const INPUT_FILE_GLOBS = ["package.json", "tsconfig.json", "*.html"];
const TEST_FILE_GLOBS = ["*.test.*", "*.spec.*"];

export interface Selection {
  extensions: string[];
  skip_directory_names: string[];
  skip_directory_prefixes: string[];
  skip_directory_suffixes: string[];
  skip_directories_containing: string[];
  skip_file_globs: string[];
  skip_paths?: string[];
  input_file_globs?: string[];
  input_absent_paths?: string[];
}

export function selection(): Selection {
  return {
    extensions: [...SOURCE_EXTENSIONS],
    skip_directory_names: [...SKIPPED_DIRECTORIES],
    skip_directory_prefixes: [...SKIPPED_DIRECTORY_PREFIXES],
    skip_directory_suffixes: [],
    skip_directories_containing: [],
    skip_file_globs: [...SKIPPED_FILE_GLOBS],
    input_file_globs: [...INPUT_FILE_GLOBS],
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

function isReadableDirectory(name: string): boolean {
  return (
    !SKIPPED_DIRECTORY_PREFIXES.some((prefix) => name.startsWith(prefix)) &&
    (TEST_DIRECTORIES.includes(name) || !SKIPPED_DIRECTORIES.includes(name))
  );
}

function isTestFile(name: string, insideTests: boolean): boolean {
  if (
    !SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension)) ||
    DECLARATION_GLOBS.some((glob) => matchesGlob(name, glob))
  ) {
    return false;
  }

  return insideTests || TEST_FILE_GLOBS.some((glob) => matchesGlob(name, glob));
}

export type Listing = Set<string> | null;

export function gitListing(root: string): Listing {
  const result = spawnSync(
    "git",
    [
      "-C",
      root,
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );

  if (result.error || result.status !== 0) {
    const message = (result.stderr ?? "").trim();

    if (!result.error && !message.includes("not a git repository")) {
      const first = message.split("\n")[0] || `exit ${result.status}`;

      process.stderr.write(
        `recognizer-scan-typescript: git could not list files (${first}); scanning every file\n`,
      );
    }

    return null;
  }

  return new Set(result.stdout.split("\0").filter((entry) => entry !== ""));
}

export function isListed(
  listing: Listing,
  root: string,
  path: string,
): boolean {
  return (
    listing === null || listing.has(relative(root, path).split(sep).join("/"))
  );
}

export function resolveListing(
  root: string,
  listing: Listing | undefined,
): Listing {
  return listing === undefined ? gitListing(root) : listing;
}

export function listTestFiles(root: string, listing?: Listing): string[] {
  const found: string[] = [];
  const listed = resolveListing(root, listing);

  const walk = (directory: string, insideTests: boolean) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (isReadableDirectory(entry.name)) {
          walk(path, insideTests || TEST_DIRECTORIES.includes(entry.name));
        }
      } else if (entry.isFile() || isFileSymlink(entry, path)) {
        if (
          isTestFile(entry.name, insideTests) &&
          isListed(listed, root, path)
        ) {
          found.push(path);
        }
      }
    }
  };

  walk(root, false);

  return found;
}

export function listSourceFiles(root: string, listing?: Listing): string[] {
  const found: string[] = [];
  const listed = resolveListing(root, listing);

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!isSkippedDirectory(entry.name)) {
          walk(path);
        }
      } else if (entry.isFile() || isFileSymlink(entry, path)) {
        if (isSourceFile(entry.name) && isListed(listed, root, path)) {
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
