import { type ChildProcess, spawn, spawnSync } from "node:child_process";
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
import { promotePending } from "./pending-checkpoints.js";

const CEILING_EXIT = 124;

const CEILING_SCRIPT = `
kill_tree() {
  for child in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$child"; done
  kill -KILL "$1" 2>/dev/null
}
limit=$1
shift
flag=$(mktemp)
"$@" &
command_pid=$!
( sleep "$limit"; echo expired > "$flag"; kill_tree "$command_pid" ) &
watchdog_pid=$!
wait "$command_pid"
status=$?
expired=0
[ -s "$flag" ] && expired=1
kill_tree "$watchdog_pid"
wait "$watchdog_pid" 2>/dev/null
rm -f "$flag"
[ "$expired" = 1 ] && exit ${CEILING_EXIT}
exit "$status"
`;

export interface DirEntry {
  name: string;
  kind: "file" | "directory" | "other";
}

export interface RunResult {
  started: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  onStderrLine?: (line: string) => void;
}

export interface Running {
  result: Promise<RunResult>;
  kill(): void;
}

export interface LaunchResult {
  started: boolean;
  message: string;
}

export interface RequestResult {
  connected: boolean;
  response: string;
  message: string;
}

export interface Io {
  exists(path: string): boolean;
  readFile(path: string): string;
  readStdin(): string;
  readLine(): Promise<string | null>;
  readBytes(path: string): Buffer;
  hashFile(path: string): string | null;
  writeFile(path: string, content: string): void;
  rename(from: string, to: string): void;
  readDir(path: string): DirEntry[];
  remove(path: string): void;
  makeTempDir(): string;
  removeDir(path: string): void;
  run(command: string, args: string[], options?: RunOptions): RunResult;
  runAsync(command: string, args: string[], options?: RunOptions): Running;
  launch(command: string, args: string[]): LaunchResult;
  request(socket: string, text: string): RequestResult;
  env(name: string): string | undefined;
  now(): number;
  stdout(text: string): void;
  stderr(text: string): void;
}

const REQUEST_SCRIPT = [
  'const net = require("net");',
  "const [socket, text] = process.argv.slice(1);",
  "const connection = net.connect(socket);",
  'let received = "";',
  'connection.on("connect", () => connection.write(text + "\\n"));',
  'connection.on("data", (chunk) => {',
  "  received += chunk;",
  '  if (received.includes("\\n")) {',
  '    process.stdout.write(received.split("\\n")[0]);',
  "    process.exit(0);",
  "  }",
  "});",
  'connection.on("error", (error) => {',
  "  process.stderr.write(error.message);",
  "  process.exit(1);",
  "});",
  'connection.on("end", () => process.exit(1));',
].join("\n");

const liveChildren = new Set<ChildProcess>();

const liveTempDirs = new Set<string>();

export function stopEverything(): void {
  for (const child of liveChildren) {
    child.kill("SIGTERM");
  }

  for (const directory of liveTempDirs) {
    rmSync(directory, { recursive: true, force: true });
  }

  liveTempDirs.clear();
  promotePending();
}

function spawnAsync(
  command: string,
  args: string[],
  options?: RunOptions,
): Running {
  let child: ChildProcess;
  let timer: NodeJS.Timeout | undefined;

  const result = new Promise<RunResult>((resolve) => {
    child = spawn(command, args, {
      cwd: options?.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      ...(options?.env === undefined
        ? {}
        : { env: { ...process.env, ...options.env } }),
    });
    liveChildren.add(child);

    let stdout = "";
    let stderr = "";
    let pending = "";
    let timedOut = false;
    let settled = false;

    const deliver = (chunk: string) => {
      if (options?.onStderrLine === undefined) {
        return;
      }

      pending += chunk;

      const lines = pending.split("\n");

      pending = lines.pop() ?? "";

      for (const line of lines) {
        options.onStderrLine(line);
      }
    };

    const settle = (value: RunResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      liveChildren.delete(child);
      resolve(value);
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      deliver(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      settle({
        started: error.code !== "ENOENT",
        status: null,
        stdout,
        stderr: error.message,
      });
    });
    child.on("close", (status, signal) => {
      if (pending !== "") {
        options?.onStderrLine?.(pending);
        pending = "";
      }

      settle({
        started: true,
        status: status ?? (signal === null ? null : 128),
        stdout,
        stderr,
        ...(timedOut ? { timedOut } : {}),
      });
    });

    if (options?.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, options.timeoutMs);
    }
  });

  return {
    result,
    kill: () => {
      child.kill("SIGTERM");
    },
  };
}

function readStdinLine(): Promise<string | null> {
  return new Promise((resolve) => {
    let buffered = "";

    const finish = (line: string | null) => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.pause();
      resolve(line);
    };

    const onData = (chunk: Buffer | string) => {
      buffered += chunk.toString();

      const newline = buffered.indexOf("\n");

      if (newline !== -1) {
        finish(buffered.slice(0, newline));
      }
    };

    const onEnd = () => finish(buffered === "" ? null : buffered);

    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.resume();
  });
}

export function nodeIo(): Io {
  return {
    exists: (path) => existsSync(path),
    readFile: (path) => readFileSync(path, "utf8"),
    readStdin: () => readFileSync(0, "utf8"),
    readLine: readStdinLine,
    readBytes: (path) => readFileSync(path),
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
    makeTempDir: () => {
      const directory = mkdtempSync(join(tmpdir(), "recognizer-scan-"));

      liveTempDirs.add(directory);

      return directory;
    },
    removeDir: (path) => {
      liveTempDirs.delete(path);
      rmSync(path, { recursive: true, force: true });
    },
    run: (command, args, options) => {
      const timeoutMs = options?.timeoutMs;
      const result =
        timeoutMs === undefined
          ? spawnSync(command, args, {
              cwd: options?.cwd,
              encoding: "utf8",
              maxBuffer: 256 * 1024 * 1024,
            })
          : spawnSync(
              "sh",
              [
                "-c",
                CEILING_SCRIPT,
                "sh",
                String(timeoutMs / 1000),
                command,
                ...args,
              ],
              {
                cwd: options?.cwd,
                encoding: "utf8",
                maxBuffer: 256 * 1024 * 1024,
              },
            );
      const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
      const timedOut =
        timeoutMs !== undefined && result.status === CEILING_EXIT;

      return {
        started: code !== "ENOENT",
        status: result.status,
        stdout: result.stdout ?? "",
        stderr: result.error ? result.error.message : (result.stderr ?? ""),
        ...(timedOut ? { timedOut } : {}),
      };
    },
    runAsync: (command, args, options) => spawnAsync(command, args, options),
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
    request: (socket, text) => {
      const result = spawnSync(
        process.execPath,
        ["-e", REQUEST_SCRIPT, socket, text],
        { encoding: "utf8", timeout: 5000 },
      );
      const response = result.stdout ?? "";

      if (result.status === 0 && response !== "") {
        return { connected: true, response, message: "" };
      }

      return {
        connected: false,
        response: "",
        message:
          result.error?.message ??
          (result.stderr !== "" ? result.stderr : "no reply"),
      };
    },
    env: (name) => process.env[name],
    now: () => Date.now(),
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

function execute(argv: string[], io: Io): number | Promise<number> {
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

function failed(error: unknown, io: Io): number {
  if (error instanceof InputError) {
    io.stderr(`${error.messages.join("\n")}\n`);
  } else {
    io.stderr(`${(error as Error).message}\n`);
  }

  return 2;
}

export function run(
  argv: string[],
  io: Io = nodeIo(),
): number | Promise<number> {
  try {
    const outcome = execute(argv, io);

    return outcome instanceof Promise
      ? outcome.catch((error: unknown) => failed(error, io))
      : outcome;
  } catch (error) {
    return failed(error, io);
  }
}
