import { createHash } from "node:crypto";
import type { DirEntry, Io, RequestResult, RunResult } from "../src/cli.js";

export interface ScannerBehaviour {
  status?: number;
  stderr?: string;
  output?: string;
  version?: string;
}

export interface ProgramEffect {
  started?: boolean;
  timedOut?: boolean;
  status?: number;
  stderr?: string;
  stdout?: string;
}

export type Program = (
  args: string[],
  files: Map<string, string>,
) => ProgramEffect | undefined;

export interface FakeOptions {
  programs?: Record<string, Program>;
  files?: Record<string, string>;
  symlinks?: string[];
  scanners?: Record<string, ScannerBehaviour>;
  env?: Record<string, string>;
  commit?: string;
  status?: string;
  diff?: string;
  launchFails?: string;
  request?: (socket: string, text: string) => string | null;
  now?: () => number;
  stdin?: string;
}

export interface Fake {
  io: Io;
  out: () => string;
  err: () => string;
  files: Map<string, string>;
  calls: { command: string; args: string[]; cwd?: string }[];
  launches: { command: string; args: string[] }[];
  removed: string[];
  writes: string[];
  renames: { from: string; to: string }[];
  readDirCalls: () => number;
  tempDirs: () => string[];
  requests: { socket: string; text: string }[];
}

export const ROOT = "/repo";
export const APP_CONFIG = "/app-config";
export const PYTHON = "recognizer-scan-python";
export const TYPESCRIPT = "recognizer-scan-typescript";

export function scanJson(
  modules: number,
  edges: number,
  overrides: Record<string, unknown> = {},
  spacing = "\t",
): string {
  const scan = {
    schema_version: 6,
    scanner: { name: "fake", version: "0.0.0" },
    commit: null,
    modified: false,
    files: [],
    selection: {
      extensions: [".py"],
      skip_directory_names: [],
      skip_directory_prefixes: [],
      skip_directory_suffixes: [],
      skip_directories_containing: [],
      skip_file_globs: [],
    },
    modules: Array.from({ length: modules }, (_, index) => ({
      id: `m${index}.py`,
      language: "python",
      kind: "module",
      members: [],
    })),
    edges: Array.from({ length: edges }, () => ({
      from: "m0.py",
      to: "m1.py",
      kind: "depends",
      line: 1,
    })),
    foreign: [],
    ...overrides,
  };

  return `${JSON.stringify(scan, null, spacing)}\n\n`;
}

export function fakeIo(options: FakeOptions = {}): Fake {
  const files = new Map(
    Object.entries({
      [`${APP_CONFIG}/config.json`]: `${JSON.stringify({ describing: { model: "sonnet", batch_size: 4 } })}\n`,
      ...options.files,
    }),
  );
  const symlinks = new Set(options.symlinks ?? []);
  const calls: { command: string; args: string[]; cwd?: string }[] = [];
  const launches: { command: string; args: string[] }[] = [];
  const removed: string[] = [];
  const writes: string[] = [];
  const renames: { from: string; to: string }[] = [];
  const temps: string[] = [];
  const requests: { socket: string; text: string }[] = [];
  let readDirs = 0;
  let clock = Date.UTC(2026, 10, 2);
  let out = "";
  let err = "";

  files.set(`${ROOT}/.keep`, "");

  function children(path: string): DirEntry[] {
    const prefix = `${path}/`;
    const seen = new Map<string, DirEntry["kind"]>();

    for (const key of [...files.keys(), ...symlinks]) {
      if (!key.startsWith(prefix)) {
        continue;
      }

      const rest = key.slice(prefix.length);
      const name = rest.split("/")[0] as string;

      if (rest.includes("/")) {
        seen.set(name, "directory");
      } else {
        seen.set(name, symlinks.has(key) ? "other" : "file");
      }
    }

    return [...seen].map(([name, kind]) => ({ name, kind }));
  }

  function isDirectory(path: string): boolean {
    return path === ROOT || children(path).length > 0;
  }

  function runNow(
    command: string,
    args: string[],
    runOptions?: { cwd?: string },
  ): RunResult {
    calls.push(
      runOptions?.cwd === undefined
        ? { command, args }
        : { command, args, cwd: runOptions.cwd },
    );

    const program = options.programs?.[command];

    if (program) {
      const effect = program(args, files) ?? {};

      return {
        started: effect.started ?? true,
        status: effect.started === false ? null : (effect.status ?? 0),
        ...(effect.timedOut ? { timedOut: true } : {}),
        stdout: effect.stdout ?? "",
        stderr: effect.stderr ?? "",
      };
    }

    if (command === "git") {
      if (options.commit && args.includes("status")) {
        return {
          started: true,
          status: 0,
          stdout: options.status ?? "",
          stderr: "",
        };
      }

      if (options.commit && args.includes("diff")) {
        return {
          started: true,
          status: 0,
          stdout: options.diff ?? "",
          stderr: "",
        };
      }

      return options.commit
        ? {
            started: true,
            status: 0,
            stdout: `${options.commit}\n`,
            stderr: "",
          }
        : { started: true, status: 128, stdout: "", stderr: "not a repo" };
    }

    const behaviour = options.scanners?.[command];

    if (!behaviour) {
      return { started: false, status: null, stdout: "", stderr: "" };
    }

    if (args[0] === "--version") {
      return {
        started: true,
        status: 0,
        stdout: `${behaviour.version ?? "0.0.0"}\n`,
        stderr: "",
      };
    }

    const output = args[args.indexOf("--output") + 1] as string;

    if (behaviour.output !== undefined) {
      files.set(output, behaviour.output);
    }

    return {
      started: true,
      status: behaviour.status ?? 0,
      stdout: "",
      stderr: behaviour.stderr ?? "",
    };
  }

  const io: Io = {
    exists: (path) => files.has(path) || isDirectory(path),
    readFile: (path) => {
      const content = files.get(path);

      if (content === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }

      return content;
    },
    readStdin: () => {
      if (options.stdin === undefined) {
        throw new Error("no stdin was set");
      }

      return options.stdin;
    },
    readBytes: (path) => Buffer.from(io.readFile(path), "utf8"),
    hashFile: (path) => {
      const content = files.get(path);

      return content === undefined
        ? null
        : createHash("sha256").update(content).digest("hex");
    },
    writeFile: (path, content) => {
      files.set(path, content);
      writes.push(path);
    },
    rename: (from, to) => {
      const content = files.get(from);

      if (content === undefined) {
        throw new Error(`ENOENT: ${from}`);
      }

      files.delete(from);
      files.set(to, content);
      renames.push({ from, to });
    },
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    readDir: (path) => {
      readDirs += 1;

      if (!isDirectory(path)) {
        throw new Error(`ENOTDIR: ${path}`);
      }

      return children(path);
    },
    remove: (path) => {
      files.delete(path);
      removed.push(path);
    },
    makeTempDir: () => {
      const path = `/tmp/fake-${temps.length}`;

      temps.push(path);
      files.set(`${path}/.keep`, "");

      return path;
    },
    removeDir: (path) => {
      for (const key of [...files.keys()]) {
        if (key.startsWith(`${path}/`)) {
          files.delete(key);
        }
      }
    },
    run: (command, args, runOptions): RunResult =>
      runNow(command, args, runOptions),
    runAsync: (command, args, runOptions) => {
      const result = runNow(command, args, runOptions);

      if (runOptions?.onStderrLine !== undefined) {
        for (const line of result.stderr.split("\n")) {
          if (line !== "") {
            runOptions.onStderrLine(line);
          }
        }
      }

      return { result: Promise.resolve(result), kill: () => {} };
    },
    launch: (command, args) => {
      launches.push({ command, args });

      return options.launchFails === undefined
        ? { started: true, message: "" }
        : { started: false, message: options.launchFails };
    },
    request: (socket, text): RequestResult => {
      requests.push({ socket, text });

      const response = options.request?.(socket, text) ?? null;

      return response === null
        ? { connected: false, response: "", message: "connection refused" }
        : { connected: true, response, message: "" };
    },
    env: (name) =>
      name === "RECOGNIZER_APP_CONFIG_DIR"
        ? (options.env?.[name] ?? APP_CONFIG)
        : options.env?.[name],
    now: () => {
      if (options.now) {
        return options.now();
      }

      clock += 1;

      return clock;
    },
  };

  return {
    io,
    out: () => out,
    err: () => err,
    files,
    calls,
    launches,
    removed,
    writes,
    renames,
    readDirCalls: () => readDirs,
    tempDirs: () => temps,
    requests,
  };
}

export const EMPTY_HASH = createHash("sha256").update("").digest("hex");

export function hashedScan(
  scan: Record<string, unknown>,
  commit: string,
): Record<string, unknown> {
  const modules = scan.modules as { id: string }[];

  return {
    ...scan,
    commit,
    modified: false,
    files: modules.map((module) => ({ path: module.id, hash: EMPTY_HASH })),
  };
}

export function mountedModules(scan: Record<string, unknown>) {
  return Object.fromEntries(
    (scan.modules as { id: string }[]).map((module) => [
      `${ROOT}/${module.id}`,
      "",
    ]),
  );
}

export function inputsOf(scan: Record<string, unknown>) {
  return Object.fromEntries(
    (scan.modules as { id: string }[]).map((module) => [module.id, EMPTY_HASH]),
  );
}
