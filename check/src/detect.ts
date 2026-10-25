import { join } from "node:path";
import type { Io } from "./cli.js";

export type Language = "python" | "typescript";

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

function languageOf(fileName: string): Language | null {
  if (fileName.endsWith(".py")) {
    return "python";
  }

  if (
    fileName === "tsconfig.json" ||
    fileName.endsWith(".ts") ||
    fileName.endsWith(".tsx")
  ) {
    return "typescript";
  }

  return null;
}

export function detectLanguages(io: Io, root: string): Language[] {
  const found = new Set<Language>();

  function walk(directory: string): void {
    for (const entry of io.readDir(directory)) {
      if (found.size === 2) {
        return;
      }

      if (entry.kind === "directory") {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(join(directory, entry.name));
        }
      } else if (entry.kind === "file") {
        const language = languageOf(entry.name);

        if (language) {
          found.add(language);
        }
      }
    }
  }

  walk(root);

  return (["python", "typescript"] as const).filter((language) =>
    found.has(language),
  );
}
