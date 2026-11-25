import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { type Io, nodeIo, run } from "../src/cli.js";
import type { Captured } from "./helpers.js";

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

export interface CliRoot extends Captured {
  run(argv: string[]): Promise<number>;
}

export function cliRoot(fakes: CliRootFakes = {}): CliRoot {
  let out = "";
  let err = "";

  const io: Io = {
    ...nodeIo(),
    ...fakes,
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
  };

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
