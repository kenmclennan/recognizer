import { spawn, spawnSync } from "node:child_process";
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

export interface Interrupted {
  status: number | null;
  signal: NodeJS.Signals | null;
  childPid: number;
}

export async function interrupt(
  box: Sandbox,
  signal: NodeJS.Signals,
  waitMs: number,
): Promise<Interrupted> {
  const request = writeRequest(box, REQUEST);
  const describer = spawn(
    process.execPath,
    [BIN, "run", "--model", "opus", request],
    {
      cwd: box.directory,
      stdio: "ignore",
      env: {
        ...process.env,
        PATH: [box.bin, dirname(process.execPath)].join(delimiter),
        FAKE_CLAUDE_RECORD: box.record,
        FAKE_CLAUDE_MODE: "sleep",
      },
    },
  );
  const exited = new Promise<[number | null, NodeJS.Signals | null]>((done) =>
    describer.on("close", (status, by) => done([status, by])),
  );
  const pidFile = `${box.record}.pid`;
  const deadline = Date.now() + waitMs;

  while (!existsSync(pidFile) || readFileSync(pidFile, "utf8") === "") {
    if (Date.now() > deadline) {
      describer.kill("SIGKILL");
      throw new Error("the stand-in claude never started");
    }

    await new Promise((done) => setTimeout(done, 20));
  }

  const childPid = Number(readFileSync(pidFile, "utf8"));

  describer.kill(signal);

  const [status, by] = await exited;

  while (alive(childPid)) {
    if (Date.now() > deadline) {
      process.kill(childPid, "SIGKILL");
      throw new Error("the stand-in claude outlived the describer");
    }

    await new Promise((done) => setTimeout(done, 20));
  }

  return { status, signal: by, childPid };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}
