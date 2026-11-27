import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest } from "@recognizer/core";
import { beforeAll } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { REPO } from "./helpers.js";
import { registerShim } from "./plugin-registry-shim.js";
import {
  requirePythonScannerVenv,
  requireSensorsVenv,
} from "./sensors-venv.js";

beforeAll(() => {
  if (!existsSync(join(REPO, "packages/describers/claude/dist/bin.js"))) {
    throw new Error("run npm run build -w recognizer-describe-claude");
  }
});

export interface RealTool {
  name: string;
  path: string;
}

function shim(directory: string, name: string, script: string): RealTool {
  const path = join(directory, name);

  writeFileSync(path, `#!/bin/sh\nexec node "${join(REPO, script)}" "$@"\n`);
  chmodSync(path, 0o755);
  registerShim(path);

  return { name, path };
}

function installed(path: string, name: string): RealTool {
  registerShim(path);

  return { name, path };
}

export function realTools(): RealTool[] {
  requirePythonScannerVenv(REPO);
  requireSensorsVenv(REPO);

  const directory = makeTempDir("recognizer-plugin-tools-");

  return [
    installed(
      join(REPO, "packages/scanners/python/.venv/bin/recognizer-scan-python"),
      "recognizer-scan-python",
    ),
    shim(
      directory,
      "recognizer-scan-typescript",
      "packages/scanners/typescript/dist/bin.js",
    ),
    ...["crap", "mutation"].map((name) =>
      installed(
        join(REPO, `packages/sensors/.venv/bin/recognizer-sense-${name}`),
        `recognizer-sense-${name}`,
      ),
    ),
    shim(
      directory,
      "recognizer-describe-claude",
      "packages/describers/claude/dist/bin.js",
    ),
  ];
}

export function manifestOf(tool: RealTool): Manifest {
  const started = Date.now();
  const result = spawnSync(tool.path, ["manifest"], { encoding: "utf8" });
  const elapsed = Date.now() - started;
  const stdout = result.stdout ?? "";
  const failure = (why: string): Error =>
    new Error(
      `${tool.name} manifest ${why}: status ${result.status}, signal ${result.signal}, spawn error ${result.error?.message ?? "none"}, ${elapsed} ms, stdout length ${stdout.length}, stderr: ${result.stderr ?? ""}`,
    );

  if (result.status !== 0) {
    throw failure("did not exit 0");
  }

  if (stdout.trim() === "") {
    throw failure("printed empty output");
  }

  try {
    return JSON.parse(stdout) as Manifest;
  } catch {
    throw failure("printed output that is not JSON");
  }
}
