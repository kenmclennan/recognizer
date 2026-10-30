import { cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { type Io, nodeIo } from "../src/cli.js";

const here = dirname(fileURLToPath(import.meta.url));

export const REPO = resolve(here, "../..");
export const FIXTURE = join(REPO, "fixtures/check");

export interface Captured {
  io: Io;
  out: () => string;
  err: () => string;
}

export function capture(): Captured {
  let out = "";
  let err = "";

  return {
    io: {
      ...nodeIo(),
      stdout: (text) => {
        out += text;
      },
      stderr: (text) => {
        err += text;
      },
    },
    out: () => out,
    err: () => err,
  };
}

export function copyFixture(): string {
  const dir = makeTempDir("recognizer-check-");
  cpSync(FIXTURE, dir, { recursive: true });

  return dir;
}

export function checkArgs(dir: string, ...extra: string[]): string[] {
  return [
    "check",
    "--scan",
    join(dir, "scan.json"),
    "--policy",
    join(dir, ".recognizer/policy.yaml"),
    ...extra,
  ];
}
