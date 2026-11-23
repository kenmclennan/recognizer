import { join } from "node:path";
import type { Repository } from "@recognizer/core";
import { readRepository } from "./adapters/filesystem/scan-translator.js";
import type { Io } from "./cli.js";
import type { Language } from "./detect.js";

export const CACHE = ".recognizer/cache";

export function cacheFile(root: string, language: Language): string {
  return join(root, CACHE, `scan.${language}.json`);
}

export function resolveCommit(io: Io, root: string): string | null {
  const result = io.run("git", ["-C", root, "rev-parse", "HEAD"]);
  const commit = result.stdout.trim();

  return result.started && result.status === 0 && commit !== "" ? commit : null;
}

export function dirtyPaths(io: Io, root: string): string[] | null {
  const result = io.run("git", [
    "-C",
    root,
    "status",
    "--porcelain",
    "--",
    ".",
    ":!.recognizer",
  ]);

  if (!result.started || result.status !== 0) {
    return null;
  }

  return result.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3));
}

export function isDirty(io: Io, root: string): boolean {
  const paths = dirtyPaths(io, root);

  return paths === null || paths.length > 0;
}

export function readCachedRepository(
  io: Io,
  root: string,
  language: Language,
): Repository | null {
  try {
    return readRepository([
      {
        language,
        document: JSON.parse(io.readFile(cacheFile(root, language))),
      },
    ]);
  } catch {
    return null;
  }
}
