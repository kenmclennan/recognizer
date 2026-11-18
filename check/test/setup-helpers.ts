import { chmodSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { REPO } from "./helpers.js";

const FIXTURE = join(REPO, "fixtures/setup-loom");

export const NO_SKIP = {
  directory_names: [],
  directory_prefixes: [],
  directory_suffixes: [],
  directory_markers: [],
  file_globs: [],
};

function example(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(REPO, `schema/manifest-examples/valid/${name}.json`),
      "utf8",
    ),
  );
}

function shim(directory: string, program: string, manifest: unknown): void {
  const path = join(directory, program);

  writeFileSync(
    path,
    `#!/bin/sh\nif [ "$1" = "manifest" ]; then\ncat <<'EOF'\n${JSON.stringify(manifest)}\nEOF\nfi\nexit 0\n`,
  );
  chmodSync(path, 0o755);
}

export function shimDirectory(sensors = true, describer = false): string {
  const directory = makeTempDir("recognizer-setup-shims-");
  const scanner = example("scanner");

  shim(directory, "recognizer-scan-typescript", {
    ...scanner,
    name: "typescript",
    languages: [
      {
        name: "typescript",
        extensions: [".ts", ".tsx"],
        files: [],
        skip: NO_SKIP,
      },
    ],
  });
  shim(directory, "recognizer-scan-rust", {
    ...scanner,
    name: "rust",
    languages: [
      { name: "rust", extensions: [".rs"], files: [], skip: NO_SKIP },
    ],
  });
  if (sensors) {
    shim(directory, "recognizer-sense-crap", example("sensor-crap"));
    shim(directory, "recognizer-sense-mutation", example("sensor-mutation"));
  }

  if (describer) {
    shim(directory, "recognizer-describe-claude", example("describer"));
  }

  return directory;
}

export function shimmedPath(directory: string): string {
  return `${directory}:/usr/bin:/bin`;
}

export function copyLoom(): string {
  const directory = makeTempDir("recognizer-setup-loom-");

  cpSync(FIXTURE, directory, { recursive: true });

  return directory;
}

export const LOOM = FIXTURE;
