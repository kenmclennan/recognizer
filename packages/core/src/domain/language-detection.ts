import {
  claimsFile,
  type LanguageRule,
  SKIPPED_DIRECTORIES,
  skipsDirectoryName,
  skipsFile,
} from "./language-rule.js";

export interface LanguageTree {
  listing: ReadonlySet<string> | null;
  entries(directory: string): readonly { name: string; kind: string }[];
}

function join(directory: string, name: string): string {
  return directory === "" ? name : `${directory}/${name}`;
}

export function detectLanguageNames(
  rules: readonly LanguageRule[],
  tree: LanguageTree,
): string[] {
  const found = new Set<string>();
  const names = new Set(rules.map((rule) => rule.name));

  function walk(directory: string, active: readonly LanguageRule[]): void {
    const entries = tree.entries(directory);

    const here = active.filter(
      (rule) =>
        directory === "" ||
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
          tree.listing === null ||
          tree.listing.has(join(directory, entry.name));

        if (!listed) {
          continue;
        }

        for (const rule of here) {
          if (claimsFile(rule, entry.name) && !skipsFile(rule, entry.name)) {
            found.add(rule.name);
          }
        }
      }
    }
  }

  walk("", rules);

  return [...found].sort();
}
