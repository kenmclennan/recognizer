import { join } from "node:path";
import {
  DETECTION_LISTING,
  detectLanguageNames,
  type LanguageRule,
} from "@recognizer/core";
import { RepositoryFilesAdapter } from "./adapters/filesystem/repository-files-adapter.js";
import type { Io } from "./cli.js";

export type { LanguageRule };

export type Language = string;

function gitListing(io: Io, root: string): Set<string> | null {
  const listing = new RepositoryFilesAdapter(io).list(root, DETECTION_LISTING);

  if (listing.from === "none") {
    if (listing.warning !== null) {
      io.stderr(
        `recognizer: git could not list files (${listing.warning}); scanning every file\n`,
      );
    }

    return null;
  }

  return new Set(listing.paths);
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
