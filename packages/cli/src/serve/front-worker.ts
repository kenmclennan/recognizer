import { createReadStream, fstatSync, writeSync } from "node:fs";
import { Socket } from "node:net";
import { createInterface } from "node:readline";
import { parentPort } from "node:worker_threads";
import { errorText } from "../errors.js";
import { HistoryChannel } from "./history-channel.js";
import { HISTORY_OPS } from "./history-ops.js";
import { parseRequest } from "./wire.js";

const STDIN = 0;
const STDOUT = 1;
const RETRY_PAUSE_MS = 5;

function pause(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_PAUSE_MS);
}

function write(text: string): void {
  const bytes = Buffer.from(text, "utf8");
  let offset = 0;

  while (offset < bytes.length) {
    try {
      offset += writeSync(STDOUT, bytes, offset);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") {
        throw error;
      }

      pause();
    }
  }
}

function send(message: unknown): void {
  write(`${JSON.stringify(message)}\n`);
}

const history = new HistoryChannel();

parentPort?.on("message", (message: { out?: string; close?: boolean }) => {
  if (message.out !== undefined) {
    write(message.out);
  }

  if (message.close === true) {
    void history.close().finally(() => process.exit(0));
  }
});

function input(): NodeJS.ReadableStream {
  const kind = fstatSync(STDIN);

  return kind.isFIFO() || kind.isSocket()
    ? new Socket({ fd: STDIN, readable: true, writable: false })
    : createReadStream("", { fd: STDIN, autoClose: false });
}

const lines = createInterface({ input: input() });

lines.on("line", (line) => {
  if (line.trim() === "") {
    return;
  }

  const parsed = parseRequest(line);

  if (!parsed.ok) {
    send({
      ...(parsed.id === null ? {} : { id: parsed.id }),
      error: parsed.error,
    });

    return;
  }

  const { id, op, args } = parsed.request;

  if (!HISTORY_OPS.has(op)) {
    parentPort?.postMessage({ request: parsed.request });

    return;
  }

  history.call(op, args).then(
    (ok) => send({ id, ok }),
    (error: unknown) => send({ id, error: errorText(error) }),
  );
});

lines.on("close", () => parentPort?.postMessage({ end: true }));
