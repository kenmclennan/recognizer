import { chmodSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Survey } from "@recognizer/core";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { REPO } from "./helpers.js";
import { registerShim, useRegisteredShims } from "./plugin-registry-shim.js";
import { writeStubSurveyPlugin } from "./stub-survey-plugin.js";

const ANSWERS = join(REPO, "packages/cli/test/survey-answers");
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
    `#!/bin/sh\nif [ "$1" = "manifest" ]; then\ncat <<'EOF'\n${JSON.stringify(manifest)}\nEOF\nfi\nif [ "$1" = "check" ]; then\necho '{"gaps":[]}'\nfi\nexit 0\n`,
  );
  chmodSync(path, 0o755);
  registerShim(path);
}

export function shimDirectory(
  sensors = true,
  describer = false,
  fixture: "loom" | "saga" = "loom",
): string {
  const directory = makeTempDir("recognizer-setup-shims-");

  writeStubSurveyPlugin(directory, {
    name: "typescript",
    order: 1,
    extensions: [".ts", ".tsx"],
    stdout: readFileSync(join(ANSWERS, `${fixture}-typescript.json`), "utf8"),
  });

  if (fixture === "loom") {
    writeStubSurveyPlugin(directory, {
      name: "rust",
      order: 2,
      extensions: [".rs"],
      stdout: readFileSync(join(ANSWERS, "loom-rust.json"), "utf8"),
    });
  }

  if (sensors) {
    shim(directory, "recognizer-sense-crap", example("sensor-crap"));
    shim(directory, "recognizer-sense-mutation", example("sensor-mutation"));
  }

  if (describer) {
    shim(directory, "recognizer-describe-claude", example("describer"));
  }

  return directory;
}

export function useShims(directory: string, onPath = false): void {
  useRegisteredShims(directory);
  process.env.PATH = onPath ? shimmedPath(directory) : "/usr/bin:/bin";
}

export function saveEnvironment(): () => void {
  const path = process.env.PATH;
  const dirs = process.env.RECOGNIZER_PLUGIN_DIRS;

  return () => {
    process.env.PATH = path;

    if (dirs === undefined) {
      delete process.env.RECOGNIZER_PLUGIN_DIRS;
    } else {
      process.env.RECOGNIZER_PLUGIN_DIRS = dirs;
    }
  };
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

const NPM_FILES = [
  "package.json",
  "package-lock.json",
  "engine/package.json",
  "app/package.json",
];

export function withToolUndo(survey: Survey): Survey {
  return {
    ...survey,
    tools: survey.tools.map((tool) =>
      tool.kind === "npm"
        ? {
            ...tool,
            files: NPM_FILES,
            undo_note:
              "package.json and the lockfile are restored; the package stays in node_modules until the next npm install",
          }
        : tool.kind === "cargo"
          ? {
              ...tool,
              undo: ["cargo", "uninstall", tool.name],
              undo_note: `${tool.name} was uninstalled`,
            }
          : tool,
    ),
  };
}
