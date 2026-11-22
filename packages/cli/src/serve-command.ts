import { createInterface } from "node:readline";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import { Service } from "./serve/service.js";
import { parseRequest } from "./serve/wire.js";

export async function runServe(argv: string[], io: Io): Promise<number> {
  if (argv.length > 0) {
    throw new InputError(["recognizer serve takes no arguments"]);
  }

  const service = new Service({
    write: (message) => io.stdout(`${JSON.stringify(message)}\n`),
  });
  const lines = createInterface({ input: process.stdin });

  for await (const line of lines) {
    if (line.trim() === "") {
      continue;
    }

    const parsed = parseRequest(line);

    if (!parsed.ok) {
      io.stdout(
        `${JSON.stringify({ ...(parsed.id === null ? {} : { id: parsed.id }), error: parsed.error })}\n`,
      );

      continue;
    }

    service.handle(parsed.request);
  }

  await service.stopAll(143);

  return 0;
}
