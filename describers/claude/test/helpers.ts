import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export const REPO = resolve(here, "../../..");
export const PACKAGE = resolve(here, "..");
export const BIN = join(PACKAGE, "dist/bin.js");
export const PROMPT_FILE = join(PACKAGE, "prompt.md");

export interface Sandbox {
  directory: string;
  bin: string;
  record: string;
}

export function sandbox(): Sandbox {
  const directory = realpathSync(makeTempDir("describe-test-"));
  const bin = join(directory, "bin");
  const fake = join(directory, "bin", "claude");

  spawnSync("mkdir", [bin]);
  copyFileSync(join(here, "fixtures/fake-claude.mjs"), fake);
  spawnSync("chmod", ["+x", fake]);

  return { directory, bin, record: join(directory, "record") };
}

export function writeRequest(box: Sandbox, request: unknown): string {
  const file = join(box.directory, "request.json");

  writeFileSync(
    file,
    typeof request === "string" ? request : JSON.stringify(request),
  );

  return file;
}

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function run(
  box: Sandbox,
  args: string[],
  env: Record<string, string> = {},
  pathDirectories: string[] = [box.bin, dirname(process.execPath)],
): Run {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    cwd: box.directory,
    env: {
      ...process.env,
      PATH: pathDirectories.join(delimiter),
      FAKE_CLAUDE_RECORD: box.record,
      ...env,
    },
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function recorded(box: Sandbox, part: "argv" | "cwd" | "stdin"): string {
  return readFileSync(`${box.record}.${part}`, "utf8");
}

export function claudeRan(box: Sandbox): boolean {
  return existsSync(`${box.record}.calls`);
}

export const REQUEST = {
  module: "shop/domain/order.py",
  kind: "module",
  source: "class Order:\n    pass\n",
  members: [{ name: "Order", kind: "class", line: 1 }],
  uses: [{ id: "shop/domain/money.py", names: ["Money"] }],
  used_by: [{ id: "shop/application/place.py", names: ["Order"] }],
};
