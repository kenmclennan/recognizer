import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FindingsRepository } from "@recognizer/core";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { nodeIo } from "../src/cli.js";

export const COMMIT = "abc123";

export function manifestOf(extra: Record<string, unknown> = {}) {
  return {
    kind: "sensor",
    name: "quick",
    display: "Quick",
    version: "1",
    protocol: 4,
    install: "brew install --cask kenmclennan/tap/recognizer",
    check: false,
    long_running: true,
    units: ["functions"],
    settings: [],
    metrics: [],
    findings: [],
    runs_tests: false,
    scoped: false,
    ...extra,
  };
}

export function pluginFile(
  root: string,
  body: string,
  manifest = manifestOf(),
): string {
  const file = join(root, `plugin-${Math.random().toString(36).slice(2)}.cjs`);

  writeFileSync(
    file,
    `const [verb, ...rest] = process.argv.slice(2);
if (verb === "manifest") {
  process.stdout.write(${JSON.stringify(JSON.stringify(manifest))} + "\\n");
  process.exit(0);
}
const [commit, output] = rest;
${body}
`,
  );

  return file;
}

export function pluginCommand(file: string): string[] {
  return [process.execPath, file, "run", "{commit}", "{output}"];
}

export function manifestCommand(file: string): string[] {
  return [process.execPath, file, "manifest"];
}

export function setup() {
  const root = makeTempDir("run-sensors-");
  const messages: string[] = [];
  const io = { ...nodeIo(), stderr: (text: string) => messages.push(text) };

  return { root, io, messages };
}

export const event = (value: Record<string, unknown>) =>
  `process.stderr.write("recognizer-event " + ${JSON.stringify(JSON.stringify(value))} + "\\n");`;

export function stagingOnly(): FindingsRepository {
  return {
    stage: () => undefined,
    settle: () => "replaced",
  } as unknown as FindingsRepository;
}
