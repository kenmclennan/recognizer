import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import type { Manifest } from "../src/plugin-manifest.js";
import { REPO } from "./helpers.js";

export interface RealTool {
  name: string;
  path: string;
}

function shim(directory: string, name: string, script: string): RealTool {
  const path = join(directory, name);

  writeFileSync(path, `#!/bin/sh\nexec node "${join(REPO, script)}" "$@"\n`);
  chmodSync(path, 0o755);

  return { name, path };
}

export function realTools(): RealTool[] {
  const directory = makeTempDir("recognizer-plugin-tools-");

  return [
    {
      name: "recognizer-scan-python",
      path: join(REPO, "scanners/python/.venv/bin/recognizer-scan-python"),
    },
    shim(
      directory,
      "recognizer-scan-typescript",
      "scanners/typescript/dist/bin.js",
    ),
    ...["crap", "mutation", "thresholds"].map((name) => ({
      name: `recognizer-sense-${name}`,
      path: join(REPO, `sensors/.venv/bin/recognizer-sense-${name}`),
    })),
    shim(
      directory,
      "recognizer-describe-claude",
      "describers/claude/dist/bin.js",
    ),
  ];
}

export function manifestOf(tool: RealTool): Manifest {
  const result = spawnSync(tool.path, ["manifest"], { encoding: "utf8" });

  return JSON.parse(result.stdout) as Manifest;
}
