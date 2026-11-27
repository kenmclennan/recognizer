import { join } from "node:path";
import { detectLanguageNames, type LanguageRule } from "@recognizer/core";
import type { Io } from "./cli.js";

export type { LanguageRule };

export type Language = string;

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
  const listing = gitListing(io, root);

  return detectLanguageNames(rules, {
    listing,
    entries: (directory) => io.readDir(join(root, directory)),
  });
}
