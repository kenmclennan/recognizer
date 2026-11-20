import { selection } from "./files.js";
import { SCAN_SCHEMA_VERSION } from "./scan-schema.js";
import { scannerVersion } from "./version.js";

export const PROTOCOL = 1;

export const INSTALL =
  "brew upgrade kenmclennan/tap/recognizer-scan-typescript || brew install kenmclennan/tap/recognizer-scan-typescript";

export function manifest() {
  const rules = selection();

  return {
    kind: "scanner",
    name: "typescript",
    display: "TypeScript",
    version: scannerVersion(),
    protocol: PROTOCOL,
    install: INSTALL,
    check: false,
    long_running: true,
    units: ["files"],
    settings: [],
    scan_schema_version: SCAN_SCHEMA_VERSION,
    languages: [
      {
        name: "typescript",
        extensions: rules.extensions,
        files: ["tsconfig.json"],
        skip: {
          directory_names: rules.skip_directory_names,
          directory_prefixes: rules.skip_directory_prefixes,
          directory_suffixes: rules.skip_directory_suffixes,
          directory_markers: rules.skip_directories_containing,
          file_globs: rules.skip_file_globs,
        },
      },
    ],
  };
}

export function manifestText(): string {
  return `${JSON.stringify(manifest(), null, 2)}\n`;
}
