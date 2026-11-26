import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { type Io, nodeIo, run } from "../src/cli.js";
import type { Captured } from "./helpers.js";
import type { FakeIo } from "./support/fake-io.js";

export type OutermostPorts = Pick<
  Io,
  | "run"
  | "runAsync"
  | "launch"
  | "request"
  | "exists"
  | "readFile"
  | "writeFile"
  | "rename"
  | "readDir"
  | "remove"
  | "makeTempDir"
  | "removeDir"
  | "modified"
  | "hashFile"
  | "readBytes"
  | "now"
  | "awake"
  | "wait"
>;

export type CliRootFakes = Partial<OutermostPorts>;

export type CliRootOptions =
  | CliRootFakes
  | ({ over: FakeIo } & { [K in keyof OutermostPorts]?: never });

export interface CliRoot extends Captured {
  run(argv: string[]): Promise<number>;
}

function isOver(options: CliRootOptions): options is { over: FakeIo } {
  return "over" in options;
}

export function cliRoot(options: CliRootOptions = {}): CliRoot {
  let out = "";
  let err = "";

  const capture = {
    stdout: (text: string) => {
      out += text;
    },
    stderr: (text: string) => {
      err += text;
    },
  };

  const io: Io = isOver(options)
    ? (Object.assign(
        Object.create(options.over),
        { ...options.over, runAsync: options.over.runAsync.bind(options.over) },
        capture,
      ) as Io)
    : { ...nodeIo(), ...options, ...capture };

  return {
    io,
    out: () => out,
    err: () => err,
    run: async (argv) => run(argv, io),
  };
}

export function answeringOnlyGit(
  answer: (args: string[]) => ReturnType<Io["run"]>,
): Io["run"] {
  const real = nodeIo().run;

  return (command, args, options) =>
    command === "git" ? answer(args) : real(command, args, options);
}

export async function timeEndToEnd<T>(options: {
  limitMs: number;
  action: () => void | Promise<void>;
  until: () => T | undefined;
}): Promise<{ value: T; elapsedMs: number; limitMs: number }> {
  const limitMs = scaledTimeout(options.limitMs);
  const start = performance.now();

  await options.action();

  for (;;) {
    const value = options.until();
    const elapsedMs = performance.now() - start;

    if (value !== undefined && elapsedMs <= limitMs) {
      return { value, elapsedMs, limitMs };
    }

    if (elapsedMs > limitMs) {
      throw new Error(
        `did not hold within ${limitMs} ms (elapsed ${Math.round(elapsedMs)} ms)`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
