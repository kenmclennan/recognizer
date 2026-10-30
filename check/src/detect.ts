import { join } from "node:path";
import type { Io } from "./cli.js";

export type Language = "python" | "typescript";

const LANGUAGES: Language[] = ["python", "typescript"];

interface SkipRules {
  directoryNames: string[];
  directoryPrefixes: string[];
  directorySuffixes: string[];
  directoryMarkers: string[];
  fileGlobs: string[];
}

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "dist",
  "build",
  ".worktrees",
  ".recognizer",
]);

const SKIP_RULES: Record<Language, SkipRules> = {
  python: {
    directoryNames: [
      "__pycache__",
      "tests",
      "dist",
      "build",
      "node_modules",
      "site-packages",
    ],
    directoryPrefixes: ["."],
    directorySuffixes: [".egg-info"],
    directoryMarkers: ["pyvenv.cfg"],
    fileGlobs: ["test_*.py", "*_test.py", "*_tests.py", "conftest.py"],
  },
  typescript: {
    directoryNames: [
      "node_modules",
      "dist",
      "build",
      "test",
      "tests",
      "__tests__",
    ],
    directoryPrefixes: ["."],
    directorySuffixes: [],
    directoryMarkers: [],
    fileGlobs: ["*.d.ts", "*.test.*", "*.spec.*"],
  },
};

function matchesGlob(name: string, glob: string): boolean {
  const pattern = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${pattern}$`).test(name);
}

function skipsDirectoryName(rules: SkipRules, name: string): boolean {
  return (
    rules.directoryNames.includes(name) ||
    rules.directoryPrefixes.some((prefix) => name.startsWith(prefix)) ||
    rules.directorySuffixes.some((suffix) => name.endsWith(suffix))
  );
}

const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function languageOf(fileName: string): Language | null {
  if (fileName.endsWith(".py")) {
    return "python";
  }

  if (
    fileName === "tsconfig.json" ||
    TYPESCRIPT_EXTENSIONS.some((extension) => fileName.endsWith(extension))
  ) {
    return "typescript";
  }

  return null;
}

function skipsFile(language: Language, fileName: string): boolean {
  if (fileName === "tsconfig.json") {
    return false;
  }

  return SKIP_RULES[language].fileGlobs.some((glob) =>
    matchesGlob(fileName, glob),
  );
}

export function detectLanguages(io: Io, root: string): Language[] {
  const found = new Set<Language>();

  function walk(directory: string, active: Language[]): void {
    const entries = io.readDir(directory);

    const here = active.filter(
      (language) =>
        directory === root ||
        !SKIP_RULES[language].directoryMarkers.some((marker) =>
          entries.some(
            (entry) => entry.kind === "file" && entry.name === marker,
          ),
        ),
    );

    for (const entry of entries) {
      if (found.size === LANGUAGES.length) {
        return;
      }

      if (entry.kind === "directory") {
        if (SKIPPED_DIRECTORIES.has(entry.name)) {
          continue;
        }

        const inside = here.filter(
          (language) => !skipsDirectoryName(SKIP_RULES[language], entry.name),
        );

        if (inside.length > 0) {
          walk(join(directory, entry.name), inside);
        }
      } else if (entry.kind === "file") {
        const language = languageOf(entry.name);

        if (
          language &&
          here.includes(language) &&
          !skipsFile(language, entry.name)
        ) {
          found.add(language);
        }
      }
    }
  }

  walk(root, LANGUAGES);

  return LANGUAGES.filter((language) => found.has(language));
}
