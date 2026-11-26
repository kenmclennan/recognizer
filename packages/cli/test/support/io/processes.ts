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

function lines(text: string, deliver: ((line: string) => void) | undefined) {
  if (deliver === undefined) {
    return;
  }

  for (const line of text.split("\n")) {
    if (line !== "") {
      deliver(line);
    }
  }
}

export class FakeProcesses {
  readonly calls: RecordedCall[] = [];
  private readonly programs = new Map<string, Program>();

  constructor(
    private readonly files: FakeFiles,
    private readonly timers: FakeTimers,
  ) {}

  register(name: string, program: Program): void {
    this.programs.set(name, program);
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
          status: null,
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
    const out: string[] = [];
    const err: string[] = [];
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

    const settle = (value: RunResult) => {
      if (settled) {
        return;
      }

      settled = true;
      cancelTimeout?.();
      scope.children.delete(child as unknown as ChildProcess);
      child.exitCode = value.status;
      child.emit("exit", value.status, null);
      finish({
        ...value,
        stdout: out.join("") + value.stdout,
        stderr: err.join("") + value.stderr,
        ...(timedOut ? { timedOut } : {}),
        ...(wasStopped(child as unknown as ChildProcess) && !timedOut
          ? { stopped: true }
          : {}),
      });
    };

    const kill = (_signal: string) => {
      killed = true;
      release();

      if (call.survivesKill) {
        return;
      }

      queueMicrotask(() =>
        settle({ started: true, status: 128, stdout: "", stderr: "" }),
      );
    };

    scope.children.add(child as unknown as ChildProcess);

    if (options?.timeoutMs !== undefined) {
      cancelTimeout = this.timers.after(options.timeoutMs, () => {
        timedOut = true;
        kill("SIGKILL");
      });
    }

    const emit = (
      text: string,
      sink: string[],
      deliver?: (line: string) => void,
    ) => {
      sink.push(text.endsWith("\n") ? text : `${text}\n`);
      lines(text, deliver);
    };

    const call: ProgramCall = {
      command,
      args,
      options,
      files: this.files,
      get killed() {
        return killed;
      },
      survivesKill: false,
      stdout: (text) => emit(text, out, options?.onStdoutLine),
      stderr: (text) => emit(text, err, options?.onStderrLine),
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

    return this.find(command) === undefined
      ? { started: false, message: `spawn ${command} ENOENT` }
      : { started: true, message: "" };
  };

  request = (_socket: string, _text: string): RequestResult => ({
    connected: false,
    response: "",
    message: "no reply",
  });
}
