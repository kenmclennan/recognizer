import { type ChildProcess, spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { REPO } from "./helpers.js";
import { isolatedPath } from "./isolated-path.js";

export const BIN = join(REPO, "packages/cli/dist/bin.js");

export type Line = Record<string, any>;

export class Serve {
  readonly lines: Line[] = [];
  readonly child: ChildProcess;
  private nextId = 1;
  private readonly waiters: (() => void)[] = [];
  exited: Promise<number | null>;

  constructor(path: string, extra: Record<string, string> = {}) {
    this.child = spawn(process.execPath, [BIN, "serve"], {
      env: {
        ...process.env,
        PATH: isolatedPath(path),
        ...extra,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr?.resume();
    createInterface({ input: this.child.stdout as NodeJS.ReadableStream }).on(
      "line",
      (text) => {
        this.lines.push(JSON.parse(text) as Line);

        for (const wake of this.waiters.splice(0)) {
          wake();
        }
      },
    );
    this.exited = new Promise((resolve) => {
      this.child.on("exit", (code) => resolve(code));
    });
  }

  send(op: string, args: Record<string, unknown>): number {
    const id = this.nextId++;

    this.child.stdin?.write(`${JSON.stringify({ id, op, args })}\n`);

    return id;
  }

  raw(text: string): void {
    this.child.stdin?.write(`${text}\n`);
  }

  async until<T>(find: () => T | undefined, ms = 30_000): Promise<T> {
    const limit = Date.now() + scaledTimeout(ms);

    for (;;) {
      const found = find();

      if (found !== undefined) {
        return found;
      }

      if (Date.now() > limit) {
        throw new Error(
          `timed out; lines so far: ${JSON.stringify(this.lines).slice(0, 2000)}`,
        );
      }

      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  async call(op: string, args: Record<string, unknown>): Promise<Line> {
    const id = this.send(op, args);

    return this.until(() => this.lines.find((line) => line.id === id));
  }

  async outcome(stream: string): Promise<Line> {
    const item = await this.until(() =>
      this.lines.find((line) => line.stream === stream && "outcome" in line),
    );

    return item.outcome;
  }

  async close(): Promise<void> {
    this.child.stdin?.end();
    await this.exited;
  }
}

export function launcher(directory: string, name: string, body: string): void {
  const path = join(directory, name);

  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

export function typescriptLaunchers(): string {
  const directory = makeTempDir("serve-launchers-");

  launcher(
    directory,
    "recognizer-scan-typescript",
    `exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@"`,
  );

  for (const sensor of ["crap", "mutation"]) {
    launcher(
      directory,
      `recognizer-sense-${sensor}`,
      `exec uv run --quiet --project ${REPO}/packages/sensors recognizer-sense-${sensor} "$@"`,
    );
  }

  return directory;
}

export function typescriptRepository(): string {
  const repository = makeTempDir("serve-repo-");

  cpSync(join(REPO, "fixtures/typescript/sample"), repository, {
    recursive: true,
  });

  return repository;
}

export function slowLaunchers(gate: string): string {
  const directory = makeTempDir("serve-slow-launchers-");

  launcher(
    directory,
    "recognizer-scan-typescript",
    [
      `case "$1" in`,
      `run)`,
      `  name=$(basename "$2")`,
      `  echo $$ > ${gate}/$name.pid`,
      `  echo "$4" > ${gate}/$name.out`,
      `  trap 'exit 143' TERM`,
      `  while [ ! -e ${gate}/release ]; do sleep 0.1; done`,
      `  exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@";;`,
      `*) exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@";;`,
      `esac`,
    ].join("\n"),
  );

  return directory;
}

export function pidOf(gate: string, repository: string): number {
  return Number(
    readFileSync(join(gate, `${basename(repository)}.pid`), "utf8").trim(),
  );
}

export async function pidFile(
  serve: Serve,
  gate: string,
  repository: string,
): Promise<number> {
  return serve.until(() => {
    try {
      const pid = pidOf(gate, repository);

      return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
      return undefined;
    }
  });
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

export function plantMarker(
  repository: string,
  changes: Record<string, unknown>,
): string {
  const cache = join(repository, ".recognizer", "cache");
  const path = join(cache, "scan-running.json");

  mkdirSync(cache, { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      version: 5,
      run_id: "11111111-2222-3333-4444-555555555555",
      pid: 1,
      pgid: 1,
      started_at: new Date().toISOString(),
      started_by: "cli",
      repository,
      sensors: [],
      describe: false,
      suites: {},
      phase: "running",
      ended_at: null,
      exit: null,
      gaps: [],
      failure: null,
      commit: null,
      ran: null,
      ...changes,
    }),
  );
  writeFileSync(join(cache, "scan-running.progress.jsonl"), "");

  return path;
}

export function failingLaunchers(): string {
  const directory = makeTempDir("serve-failing-launchers-");

  launcher(
    directory,
    "recognizer-scan-typescript",
    [
      `case "$1" in`,
      `run) exit 3;;`,
      `*) exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@";;`,
      `esac`,
    ].join("\n"),
  );

  return directory;
}
