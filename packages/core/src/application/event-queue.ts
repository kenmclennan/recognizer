import type { ScanEvent } from "../domain/index.js";

export class EventQueue {
  private readonly items: ScanEvent[] = [];
  private waiting: ((result: IteratorResult<ScanEvent>) => void) | null = null;
  private idle: (() => void)[] = [];
  private closed = false;
  private attached = false;

  push(event: ScanEvent): void {
    if (this.waiting !== null) {
      const resolve = this.waiting;

      this.waiting = null;
      resolve({ value: event, done: false });

      return;
    }

    this.items.push(event);
  }

  close(): void {
    this.closed = true;

    if (this.waiting !== null) {
      const resolve = this.waiting;

      this.waiting = null;
      resolve({ value: undefined, done: true });
    }

    this.release();
  }

  drained(): Promise<void> {
    if (!this.attached || this.closed || this.items.length === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idle.push(resolve);
    });
  }

  private release(): void {
    const waiters = this.idle;

    this.idle = [];

    for (const resolve of waiters) {
      resolve();
    }
  }

  iterable(): AsyncIterable<ScanEvent> {
    return {
      [Symbol.asyncIterator]: () => {
        this.attached = true;

        return {
          next: (): Promise<IteratorResult<ScanEvent>> => {
            const event = this.items.shift();

            if (event !== undefined) {
              return Promise.resolve({ value: event, done: false });
            }

            this.release();

            if (this.closed) {
              return Promise.resolve({ value: undefined, done: true });
            }

            return new Promise((resolve) => {
              this.waiting = resolve;
            });
          },
        };
      },
    };
  }
}
