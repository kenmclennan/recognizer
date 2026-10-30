import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { COMMANDS } from "./commands.js";
import { InputError } from "./errors.js";
import { fullHelp, shortHelp } from "./help.js";

export interface DirEntry {
  name: string;
  kind: "file" | "directory" | "other";
}

export interface RunResult {
  started: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
}

export interface LaunchResult {
  started: boolean;
  message: string;
}

export interface Io {
  exists(path: string): boolean;
  readFile(path: string): string;
  hashFile(path: string): string | null;
  writeFile(path: string, content: string): void;
  rename(from: string, to: string): void;
  readDir(path: string): DirEntry[];
  remove(path: string): void;
  makeTempDir(): string;
  removeDir(path: string): void;
  run(command: string, args: string[], options?: RunOptions): RunResult;
  launch(command: string, args: string[]): LaunchResult;
  env(name: string): string | undefined;
  stdout(text: string): void;
  stderr(text: string): void;
}

export function nodeIo(): Io {
  return {
    exists: (path) => existsSync(path),
    readFile: (path) => readFileSync(path, "utf8"),
    hashFile: (path) => {
      try {
        return createHash("sha256").update(readFileSync(path)).digest("hex");
      } catch {
        return null;
      }
    },
    writeFile: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
    rename: (from, to) => renameSync(from, to),
    readDir: (path) =>
      readdirSync(path, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory()
          ? "directory"
          : entry.isFile()
            ? "file"
            : "other",
      })),
    remove: (path) => rmSync(path, { force: true }),
    makeTempDir: () => mkdtempSync(join(tmpdir(), "recognizer-scan-")),
    removeDir: (path) => rmSync(path, { recursive: true, force: true }),
    run: (command, args, options) => {
      const result = spawnSync(command, args, {
        cwd: options?.cwd,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      });
      const code = (result.error as NodeJS.ErrnoException | undefined)?.code;

      return {
        started: code !== "ENOENT",
        status: result.status,
        stdout: result.stdout ?? "",
        stderr: result.error ? result.error.message : (result.stderr ?? ""),
      };
    },
    launch: (command, args) => {
      try {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });

        child.on("error", () => {});
        child.unref();

        return { started: true, message: "" };
      } catch (error) {
        return { started: false, message: (error as Error).message };
      }
    },
    env: (name) => process.env[name],
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  };
}

export function packageVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };

  return manifest.version;
}

function execute(argv: string[], io: Io): number {
  const [first, ...rest] = argv;

  if (first === undefined) {
    io.stderr(shortHelp());

    return 2;
  }

  if (argv.length === 1 && (first === "--help" || first === "-h")) {
    io.stdout(shortHelp());

    return 0;
  }

  if (argv.length === 1 && (first === "--version" || first === "-V")) {
    io.stdout(`${packageVersion()}\n`);

    return 0;
  }

  const command = COMMANDS.find((entry) => entry.name === first);

  if (command === undefined) {
    throw new InputError([shortHelp().trimEnd()]);
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    io.stdout(fullHelp(command));

    return 0;
  }

  return command.run(rest, io);
}

export function run(argv: string[], io: Io = nodeIo()): number {
  try {
    return execute(argv, io);
  } catch (error) {
    if (error instanceof InputError) {
      io.stderr(`${error.messages.join("\n")}\n`);
    } else {
      io.stderr(`${(error as Error).message}\n`);
    }

    return 2;
  }
}
