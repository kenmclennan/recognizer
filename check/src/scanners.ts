import { isAbsolute } from "node:path";
import type { Io } from "./cli.js";
import type { Language } from "./detect.js";
import { BREW_FIX } from "./preflight.js";

export interface ScannerSpec {
  language: Language;
  name: string;
  variable: string;
  install: string;
}

export const SCANNERS: ScannerSpec[] = [
  {
    language: "python",
    name: "recognizer-scan-python",
    variable: "RECOGNIZER_SCAN_PYTHON",
    install: BREW_FIX,
  },
  {
    language: "typescript",
    name: "recognizer-scan-typescript",
    variable: "RECOGNIZER_SCAN_TYPESCRIPT",
    install: BREW_FIX,
  },
  {
    language: "kotlin",
    name: "recognizer-scan-kotlin",
    variable: "RECOGNIZER_SCAN_KOTLIN",
    install: BREW_FIX,
  },
  {
    language: "rust",
    name: "recognizer-scan-rust",
    variable: "RECOGNIZER_SCAN_RUST",
    install: BREW_FIX,
  },
  {
    language: "csharp",
    name: "recognizer-scan-csharp",
    variable: "RECOGNIZER_SCAN_CSHARP",
    install: BREW_FIX,
  },
];

export function scannerFor(language: Language): ScannerSpec {
  return SCANNERS.find((spec) => spec.language === language) as ScannerSpec;
}

export type Resolution =
  | { ok: true; command: string }
  | { ok: false; message: string };

export function resolveCommand(io: Io, spec: ScannerSpec): Resolution {
  const override = io.env(spec.variable);

  if (override === undefined || override === "") {
    return { ok: true, command: spec.name };
  }

  if (!isAbsolute(override)) {
    return {
      ok: false,
      message: `${spec.variable} must be an absolute path: ${override}`,
    };
  }

  return { ok: true, command: override };
}

export function buildArgs(
  repository: string,
  output: string,
  commit: string | null,
  modified: boolean | null,
): string[] {
  const args = [repository, "--output", output];

  if (commit) {
    args.push("--commit", commit);
  }

  if (modified !== null) {
    args.push("--modified", String(modified));
  }

  return args;
}

export function notInstalledMessage(spec: ScannerSpec): string {
  return `${spec.name} is not installed: install it with ${spec.install} or set ${spec.variable} to its absolute path`;
}
