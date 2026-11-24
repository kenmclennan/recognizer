import type { Io, RunOptions } from "./cli.js";

export function environmentIo(
  io: Io,
  pairs: Readonly<Record<string, string>>,
): Io {
  const merged = (options?: RunOptions): RunOptions => ({
    ...options,
    env: { ...pairs, ...options?.env },
  });

  return Object.assign(Object.create(io) as Io, {
    env: (name: string) => pairs[name] ?? io.env(name),
    run: (command: string, args: string[], options?: RunOptions) =>
      io.run(command, args, merged(options)),
    runAsync: (command: string, args: string[], options?: RunOptions) =>
      io.runAsync(command, args, merged(options)),
  });
}
