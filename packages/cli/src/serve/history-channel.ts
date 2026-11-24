import { Worker } from "node:worker_threads";

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class HistoryChannel {
  private worker: Worker | undefined;
  private readonly pending = new Map<number, Pending>();
  private counter = 0;

  private start(): Worker {
    const worker = new Worker(new URL("./history-worker.js", import.meta.url));

    worker.unref();
    worker.on(
      "message",
      (reply: { id: number; ok?: unknown; error?: string }) => {
        const held = this.pending.get(reply.id);

        this.pending.delete(reply.id);

        if (reply.error === undefined) {
          held?.resolve(reply.ok);
        } else {
          held?.reject(new Error(reply.error));
        }
      },
    );
    worker.on("error", (error: Error) => this.fail(error));
    worker.on("exit", () => {
      this.worker = undefined;
      this.fail(new Error("the history worker stopped"));
    });

    return worker;
  }

  private fail(error: Error): void {
    for (const held of this.pending.values()) {
      held.reject(error);
    }

    this.pending.clear();
  }

  call(op: string, args: Record<string, unknown>): Promise<unknown> {
    this.worker ??= this.start();

    const id = ++this.counter;
    const worker = this.worker;

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, op, args });
    });
  }

  async close(): Promise<void> {
    const worker = this.worker;

    this.worker = undefined;
    await worker?.terminate();
  }
}
