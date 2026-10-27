import type { DirEntry, Io, RunResult } from "../src/cli.js";

export interface ScannerBehaviour {
  status?: number;
  stderr?: string;
  output?: string;
}

export interface FakeOptions {
  files?: Record<string, string>;
  symlinks?: string[];
  scanners?: Record<string, ScannerBehaviour>;
  env?: Record<string, string>;
  commit?: string;
  status?: string;
  launchFails?: string;
}

export interface Fake {
  io: Io;
  out: () => string;
  err: () => string;
  files: Map<string, string>;
  calls: { command: string; args: string[] }[];
  launches: { command: string; args: string[] }[];
  removed: string[];
  writes: string[];
  readDirCalls: () => number;
  tempDirs: () => string[];
}

export const ROOT = "/repo";
export const PYTHON = "recognizer-scan-python";
export const TYPESCRIPT = "recognizer-scan-typescript";

export function scanJson(
  modules: number,
  edges: number,
  overrides: Record<string, unknown> = {},
  spacing = "\t",
): string {
  const scan = {
    schema_version: 2,
    scanner: { name: "fake", version: "0.0.0" },
    commit: null,
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
  const files = new Map(Object.entries(options.files ?? {}));
  const symlinks = new Set(options.symlinks ?? []);
  const calls: { command: string; args: string[] }[] = [];
  const launches: { command: string; args: string[] }[] = [];
  const removed: string[] = [];
  const writes: string[] = [];
  const temps: string[] = [];
  let readDirs = 0;
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

  const io: Io = {
    exists: (path) => files.has(path) || isDirectory(path),
    readFile: (path) => {
      const content = files.get(path);

      if (content === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }

      return content;
    },
    writeFile: (path, content) => {
      files.set(path, content);
      writes.push(path);
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
    run: (command, args): RunResult => {
      calls.push({ command, args });

      if (command === "git") {
        if (options.commit && args.includes("status")) {
          return {
            started: true,
            status: 0,
            stdout: options.status ?? "",
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
    },
    launch: (command, args) => {
      launches.push({ command, args });

      return options.launchFails === undefined
        ? { started: true, message: "" }
        : { started: false, message: options.launchFails };
    },
    env: (name) => options.env?.[name],
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
    readDirCalls: () => readDirs,
    tempDirs: () => temps,
  };
}
