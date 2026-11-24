import type { Io } from "../cli.js";
import { STARTED_BY_VARIABLE } from "../scan-marker.js";

export function quiet(io: Io): Io {
  return Object.assign(Object.create(io) as Io, {
    env: (name: string) =>
      name === STARTED_BY_VARIABLE ? "app" : process.env[name],
    stdout: (chunk: string) => io.stderr(chunk),
  });
}
