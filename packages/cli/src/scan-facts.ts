import { join } from "node:path";
import type { Io } from "./cli.js";
import type { Language } from "./detect.js";
import { type RecordedScan, validateAcceptedScan } from "./scan.js";

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

export function readCachedScan(
  io: Io,
  root: string,
  language: Language,
): RecordedScan | null {
  try {
    return validateAcceptedScan(
      JSON.parse(io.readFile(cacheFile(root, language))),
    ) as RecordedScan;
  } catch {
    return null;
  }
}
