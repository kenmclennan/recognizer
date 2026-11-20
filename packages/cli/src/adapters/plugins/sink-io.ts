import type { Io } from "../../cli.js";

export function sinkIo(
  io: Io,
  say: (stream: "stdout" | "stderr", text: string) => void,
): Io {
  return Object.assign(Object.create(io) as Io, {
    stdout: (text: string) => say("stdout", text),
    stderr: (text: string) => say("stderr", text),
  });
}
