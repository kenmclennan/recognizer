import {
  type InstalledPlugin,
  languageRulesOf as rulesOf,
} from "@recognizer/core";
import type { LanguageRule } from "./detect.js";

export function buildArgs(
  repository: string,
  output: string,
  commit: string | null,
  modified: boolean | null,
): string[] {
  const args = ["run", repository, "--output", output];

  if (commit) {
    args.push("--commit", commit);
  }

  if (modified !== null) {
    args.push("--modified", String(modified));
  }

  return args;
}

export function languageRulesOf(
  scanners: readonly InstalledPlugin[],
): LanguageRule[] {
  return rulesOf<LanguageRule>(scanners);
}

export {
  chooseScanner,
  claimsLanguage,
  type ScannerChoice,
} from "@recognizer/core";
