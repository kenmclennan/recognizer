import { join, relative } from "node:path";
import type { Io } from "./cli.js";

export type Language = string;

export interface LanguageRule {
  name: string;
  extensions: string[];
  files: string[];
  skip: {
    directory_names: string[];
    directory_prefixes: string[];
    directory_suffixes: string[];
    directory_markers: string[];
    file_globs: string[];
  };
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

function matchesGlob(name: string, glob: string): boolean {
  const pattern = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${pattern}$`).test(name);
}

function skipsDirectoryName(rule: LanguageRule, name: string): boolean {
  return (
    rule.skip.directory_names.includes(name) ||
    rule.skip.directory_prefixes.some((prefix) => name.startsWith(prefix)) ||
    rule.skip.directory_suffixes.some((suffix) => name.endsWith(suffix))
  );
}

function claims(rule: LanguageRule, fileName: string): boolean {
  return (
    rule.files.includes(fileName) ||
    rule.extensions.some((extension) => fileName.endsWith(extension))
  );
}

function skipsFile(rule: LanguageRule, fileName: string): boolean {
  if (rule.files.includes(fileName)) {
    return false;
  }

  return rule.skip.file_globs.some((glob) => matchesGlob(fileName, glob));
}

function gitListing(io: Io, root: string): Set<string> | null {
  const result = io.run("git", [
    "-C",
    root,
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);

  if (!result.started) {
    return null;
  }

  if (result.status !== 0) {
    const message = result.stderr.trim();

    if (!message.includes("not a git repository")) {
      const first = message.split("\n")[0] || `exit ${result.status}`;

      io.stderr(
        `recognizer: git could not list files (${first}); scanning every file\n`,
      );
    }

    return null;
  }

  return new Set(result.stdout.split("\0").filter((entry) => entry !== ""));
}

export function detectLanguages(
  io: Io,
  root: string,
  rules: readonly LanguageRule[],
): Language[] {
  const found = new Set<Language>();
  const names = new Set(rules.map((rule) => rule.name));
  const listing = gitListing(io, root);

  function walk(directory: string, active: readonly LanguageRule[]): void {
    const entries = io.readDir(directory);

    const here = active.filter(
      (rule) =>
        directory === root ||
        !rule.skip.directory_markers.some((marker) =>
          entries.some(
            (entry) => entry.kind === "file" && entry.name === marker,
          ),
        ),
    );

    for (const entry of entries) {
      if (found.size === names.size) {
        return;
      }

      if (entry.kind === "directory") {
        if (SKIPPED_DIRECTORIES.has(entry.name)) {
          continue;
        }

        const inside = here.filter(
          (rule) => !skipsDirectoryName(rule, entry.name),
        );

        if (inside.length > 0) {
          walk(join(directory, entry.name), inside);
        }
      } else if (entry.kind === "file") {
        const listed =
          listing === null ||
          listing.has(relative(root, join(directory, entry.name)));

        if (!listed) {
          continue;
        }

        for (const rule of here) {
          if (claims(rule, entry.name) && !skipsFile(rule, entry.name)) {
            found.add(rule.name);
          }
        }
      }
    }
  }

  walk(root, rules);

  return [...found].sort();
}
