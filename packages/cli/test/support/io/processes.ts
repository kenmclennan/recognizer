import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { basename } from "node:path";
import type {
  LaunchResult,
  RequestResult,
  Running,
  RunOptions,
  RunResult,
} from "../../../src/cli.js";
import { type StopScope, wasStopped } from "../../../src/stop-scope.js";
import type { FakeFiles } from "./files.js";
import type { FakeTimers } from "./timers.js";

export interface ProgramCall {
  command: string;
  args: string[];
  options: RunOptions | undefined;
  stdin: string;
  files: FakeFiles;
  readonly killed: boolean;
  survivesKill: boolean;
  stdout(text: string): void;
  stderr(text: string): void;
  whenKilled(): Promise<void>;
}

export type Program = (call: ProgramCall) => RunResult | Promise<RunResult>;

export interface RecordedCall {
  command: string;
  args: string[];
}

export type SocketResponder = (text: string) => string | null;

function noReply(message: string): RequestResult {
  return { connected: false, response: "", message };
}

export class FakeProcesses {
  readonly calls: RecordedCall[] = [];
  private readonly programs = new Map<string, Program>();
  private readonly sockets = new Map<string, SocketResponder>();

  constructor(
    private readonly files: FakeFiles,
    private readonly timers: FakeTimers,
  ) {}

  register(name: string, program: Program): void {
    this.programs.set(name, program);
  }

  listen(socket: string, respond: SocketResponder): void {
    this.sockets.set(socket, respond);
  }

  private find(command: string): Program | undefined {
    return this.programs.get(basename(command));
  }

  run = (command: string, args: string[], options?: RunOptions): RunResult => {
    this.calls.push({ command, args });

    const program = this.find(command);

    if (program === undefined) {
      return {
        started: false,
        status: null,
        stdout: "",
        stderr: `spawn ${command} ENOENT`,
      };
    }

    const out: string[] = [];
    const err: string[] = [];
    const outcome = program({
      command,
      args,
      options,
      stdin: options?.input ?? "",
      files: this.files,
      killed: false,
      survivesKill: false,
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      whenKilled: () => new Promise(() => {}),
    });

    if (outcome instanceof Promise) {
      if (options?.timeoutMs !== undefined) {
        return {
          started: true,
          status: 124,
          stdout: out.join(""),
          stderr: err.join(""),
          timedOut: true,
        };
      }

      throw new Error(
        `program ${command} did not finish in a synchronous run without a timeout`,
      );
    }

    return {
      ...outcome,
      stdout: out.join("") + outcome.stdout,
      stderr: err.join("") + outcome.stderr,
    };
  };

  runAsync = (
    command: string,
    args: string[],
    options: RunOptions | undefined,
    scope: StopScope,
  ): Running => {
    this.calls.push({ command, args });

    const program = this.find(command);

    if (program === undefined) {
      return {
        result: Promise.resolve({
          started: false,
          status: null,
          stdout: "",
          stderr: `spawn ${command} ENOENT`,
        }),
        kill: () => {},
      };
    }

    const child = Object.assign(new EventEmitter(), {
      pid: undefined,
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill: (signal?: string) => {
        kill(signal ?? "SIGTERM");

        return true;
      },
    });
    let outText = "";
    let errText = "";
    let pendingOut = "";
    let pendingErr = "";
    let killed = false;
    let timedOut = false;
    let settled = false;
    let release: () => void = () => {};
    const killedSignal = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finish: (result: RunResult) => void = () => {};
    const result = new Promise<RunResult>((resolve) => {
      finish = resolve;
    });
    let cancelTimeout: (() => void) | undefined;
    let cancelGrace: (() => void) | undefined;

    const keepErr = (line: string, whole: string) => {
      if (options?.onStderrLine?.(line) !== true) {
        errText += whole;
      }
    };

    const feedOut = (text: string) => {
      outText += text;

      if (options?.onStdoutLine === undefined) {
        return;
      }

      const parts = (pendingOut + text).split("\n");

      pendingOut = parts.pop() ?? "";

      for (const line of parts) {
        options.onStdoutLine(line);
      }
    };

    const feedErr = (text: string) => {
      if (options?.onStderrLine === undefined) {
        errText += text;

        return;
      }

      const parts = (pendingErr + text).split("\n");

      pendingErr = parts.pop() ?? "";

      for (const line of parts) {
        keepErr(line, `${line}\n`);
      }
    };

    const flush = () => {
      if (pendingOut !== "") {
        options?.onStdoutLine?.(pendingOut);
        pendingOut = "";
      }

      if (pendingErr !== "") {
        keepErr(pendingErr, pendingErr);
        pendingErr = "";
      }
    };

    const settle = (value: RunResult) => {
      if (settled) {
        return;
      }

      settled = true;
      cancelTimeout?.();
      cancelGrace?.();
      scope.children.delete(child as unknown as ChildProcess);
      flush();
      child.exitCode = value.status;
      child.emit("exit", value.status, null);
      finish({
        ...value,
        stdout: outText + value.stdout,
        stderr: errText + value.stderr,
        ...(timedOut ? { timedOut } : {}),
        ...(wasStopped(child as unknown as ChildProcess) && !timedOut
          ? { stopped: true }
          : {}),
      });
    };

    const kill = (signal: string) => {
      killed = true;
      release();

      if (call.survivesKill && signal !== "SIGKILL") {
        return;
      }

      queueMicrotask(() =>
        settle({ started: true, status: 128, stdout: "", stderr: "" }),
      );
    };

    scope.children.add(child as unknown as ChildProcess);

    if (options?.timeoutMs !== undefined) {
      const graceMs = options.graceMs;

      cancelTimeout = this.timers.after(options.timeoutMs, () => {
        timedOut = true;

        if (graceMs === undefined) {
          kill("SIGKILL");

          return;
        }

        kill("SIGTERM");
        cancelGrace = this.timers.after(graceMs, () => kill("SIGKILL"));
      });
    }

    const call: ProgramCall = {
      command,
      args,
      options,
      stdin: options?.input ?? "",
      files: this.files,
      get killed() {
        return killed;
      },
      survivesKill: false,
      stdout: feedOut,
      stderr: feedErr,
      whenKilled: () => killedSignal,
    };

    void Promise.resolve(program(call)).then(settle, (error: Error) =>
      settle({ started: true, status: 1, stdout: "", stderr: error.message }),
    );

    return {
      result,
      kill: (signal = "SIGTERM") => {
        kill(signal);
      },
    };
  };

  launch = (command: string, args: string[]): LaunchResult => {
    this.calls.push({ command, args });

    const program = this.find(command);

    if (program !== undefined) {
      const call: ProgramCall = {
        command,
        args,
        options: undefined,
        stdin: "",
        files: this.files,
        killed: false,
        survivesKill: false,
        stdout: () => {},
        stderr: () => {},
        whenKilled: () => new Promise(() => {}),
      };

      try {
        void Promise.resolve(program(call)).catch(() => {});
      } catch {}
    }

    return { started: true, message: "" };
  };

  request = (socket: string, text: string): RequestResult => {
    const respond = this.sockets.get(socket);

    if (respond === undefined) {
      return noReply(`connect ENOENT ${socket}`);
    }

    const reply = respond(text);

    if (reply === null || !reply.includes("\n")) {
      return noReply("no reply");
    }

    const response = reply.split("\n")[0] ?? "";

    return response === ""
      ? noReply("no reply")
      : { connected: true, response, message: "" };
  };
}
