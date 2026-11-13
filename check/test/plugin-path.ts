import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { type Io, nodeIo } from "../src/cli.js";
import { REPO } from "./helpers.js";

export type ManifestOverrides = Record<string, unknown>;

export function exampleOf(kind: string, name: string): Record<string, unknown> {
  const file =
    kind === "scanner"
      ? "scanner.json"
      : kind === "describer"
        ? "describer.json"
        : `sensor-${name}.json`;
  const base = JSON.parse(
    readFileSync(join(REPO, "schema/manifest-examples/valid", file), "utf8"),
  ) as Record<string, unknown>;

  return base;
}

export function manifestFor(
  kind: "scanner" | "sensor" | "describer",
  name: string,
  overrides: ManifestOverrides = {},
): Record<string, unknown> {
  const base = exampleOf(
    kind,
    kind === "sensor" && ["crap", "mutation", "thresholds"].includes(name)
      ? name
      : "crap",
  );

  return { ...base, kind, name, ...overrides };
}

export interface ShimOptions {
  status?: number;
  check?: string;
  checkStatus?: number;
}

export function shimScript(output: string, options: ShimOptions = {}): string {
  const check = options.check ?? '{"gaps":[]}';

  return [
    "#!/bin/sh",
    'if [ "$1" = "manifest" ]; then',
    "cat <<'RECOGNIZER_EOF'",
    output,
    "RECOGNIZER_EOF",
    `exit ${options.status ?? 0}`,
    "fi",
    'if [ "$1" = "check" ]; then',
    "cat <<'RECOGNIZER_EOF'",
    check,
    "RECOGNIZER_EOF",
    `exit ${options.checkStatus ?? 0}`,
    "fi",
    "exit 0",
    "",
  ].join("\n");
}

export function writeShim(
  directory: string,
  program: string,
  manifest: Record<string, unknown> | string,
  options: ShimOptions = {},
): string {
  mkdirSync(directory, { recursive: true });

  const path = join(directory, program);

  writeFileSync(
    path,
    shimScript(
      typeof manifest === "string" ? manifest : JSON.stringify(manifest),
      options,
    ),
  );
  chmodSync(path, 0o755);

  return path;
}

export function ioWithPath(directories: string[]): Io {
  const base = nodeIo();

  return {
    ...base,
    env: (name) => (name === "PATH" ? directories.join(":") : base.env(name)),
  };
}

export function tempDirectory(prefix: string): string {
  return makeTempDir(prefix);
}
