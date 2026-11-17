import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll } from "vitest";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import type { Manifest } from "../src/plugin-manifest.js";
import { REPO } from "./helpers.js";

beforeAll(() => {
  if (!existsSync(join(REPO, "describers/claude/dist/bin.js"))) {
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
    ...["crap", "mutation"].map((name) => ({
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
