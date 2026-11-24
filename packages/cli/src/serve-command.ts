import { Worker } from "node:worker_threads";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import { Service } from "./serve/service.js";
import type { Request } from "./serve/wire.js";

type FrontMessage = { request: Request } | { end: true };

export async function runServe(argv: string[], _io: Io): Promise<number> {
  if (argv.length > 0) {
    throw new InputError(["recognizer serve takes no arguments"]);
  }

  const front = new Worker(new URL("./serve/front-worker.js", import.meta.url));
  const ended = new Promise<void>((resolve, reject) => {
    front.on("error", reject);
    front.on("message", (message: FrontMessage) => {
      if ("request" in message) {
        service.handle(message.request);
      } else {
        resolve();
      }
    });
  });
  const stopped = new Promise<void>((resolve) => front.on("exit", resolve));
  const service = new Service({
    write: (message) =>
      front.postMessage({ out: `${JSON.stringify(message)}\n` }),
  });

  await ended;
  await service.stopAll(143);
  front.postMessage({ close: true });
  await stopped;

  return 0;
}
