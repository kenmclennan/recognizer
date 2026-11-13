import type { LanguageRule } from "./detect.js";
import type { InstalledPlugin } from "./plugin-discovery.js";

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
  return scanners.flatMap(
    (scanner) => (scanner.manifest.languages ?? []) as LanguageRule[],
  );
}

export function claimsLanguage(
  scanner: InstalledPlugin,
  language: string,
): boolean {
  return languageRulesOf([scanner]).some((rule) => rule.name === language);
}

export type ScannerChoice =
  | { ok: true; scanner: InstalledPlugin }
  | {
      ok: false;
      reason: "not-installed" | "ambiguous-scanner" | "invalid-choice";
      message: string;
      claimants: string[];
    };

export function chooseScanner(
  language: string,
  scanners: readonly InstalledPlugin[],
  named: string | undefined,
): ScannerChoice {
  const claimants = scanners.filter((one) => claimsLanguage(one, language));
  const names = claimants.map((one) => one.name);

  if (named !== undefined) {
    const installed = scanners.find((one) => one.name === named);

    if (installed === undefined) {
      return {
        ok: false,
        reason: "not-installed",
        message: `the config names the scanner ${named} for ${language} and recognizer-scan-${named} is not installed`,
        claimants: names,
      };
    }

    return claimsLanguage(installed, language)
      ? { ok: true, scanner: installed }
      : {
          ok: false,
          reason: "invalid-choice",
          message: `the config names the scanner ${named} for ${language}, but its manifest does not claim ${language}`,
          claimants: names,
        };
  }

  if (claimants.length === 0) {
    return {
      ok: false,
      reason: "not-installed",
      message: `no installed scanner claims ${language}`,
      claimants: names,
    };
  }

  if (claimants.length > 1) {
    return {
      ok: false,
      reason: "ambiguous-scanner",
      message: `${names.join(" and ")} both claim ${language}: name one with recognizer config scanners.${language} <name>`,
      claimants: names,
    };
  }

  return { ok: true, scanner: claimants[0] as InstalledPlugin };
}
