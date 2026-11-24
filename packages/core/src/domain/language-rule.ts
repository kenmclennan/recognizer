import { baseName } from "./path.js";

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

export const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "dist",
  "build",
  ".worktrees",
  ".recognizer",
]);

export function matchesGlob(name: string, glob: string): boolean {
  const pattern = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${pattern}$`).test(name);
}

export function skipsDirectoryName(rule: LanguageRule, name: string): boolean {
  return (
    rule.skip.directory_names.includes(name) ||
    rule.skip.directory_prefixes.some((prefix) => name.startsWith(prefix)) ||
    rule.skip.directory_suffixes.some((suffix) => name.endsWith(suffix))
  );
}

export function claimsFile(rule: LanguageRule, fileName: string): boolean {
  return (
    rule.files.includes(fileName) ||
    rule.extensions.some((extension) => fileName.endsWith(extension))
  );
}

export function skipsFile(rule: LanguageRule, fileName: string): boolean {
  if (rule.files.includes(fileName)) {
    return false;
  }

  return rule.skip.file_globs.some((glob) => matchesGlob(fileName, glob));
}

export function readsDirectoriesOf(
  rule: LanguageRule,
  path: string,
  hasFile: (path: string) => boolean,
): boolean {
  const parts = path.split("/").slice(0, -1);

  for (let depth = 0; depth < parts.length; depth++) {
    const directory = parts.slice(0, depth + 1).join("/");
    const directoryName = parts[depth] ?? "";

    if (
      SKIPPED_DIRECTORIES.has(directoryName) ||
      skipsDirectoryName(rule, directoryName) ||
      rule.skip.directory_markers.some((marker) =>
        hasFile(`${directory}/${marker}`),
      )
    ) {
      return false;
    }
  }

  return true;
}

export function readsPath(
  rule: LanguageRule,
  path: string,
  hasFile: (path: string) => boolean,
): boolean {
  const name = baseName(path);

  return (
    claimsFile(rule, name) &&
    !skipsFile(rule, name) &&
    readsDirectoriesOf(rule, path, hasFile)
  );
}
