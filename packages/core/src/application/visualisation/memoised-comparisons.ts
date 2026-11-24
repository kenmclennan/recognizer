import type { Clock } from "../shared/ports/clock.js";

export const MEMO_LIMIT = 16;
export const MEMO_FOUND_MS = 600_000;
export const MEMO_FAILED_MS = 60_000;

interface Remembered {
  key: string;
  at: number;
  found: { ok: boolean };
}

export class MemoisedComparisons {
  private memo: Remembered[] = [];
  private readonly flights = new Map<string, Promise<unknown>>();

  constructor(private readonly clock: Clock) {}

  async once<T extends { ok: boolean }>(
    key: string,
    compute: () => Promise<T>,
  ): Promise<T> {
    const remembered = this.remembered<T>(key);

    if (remembered !== undefined) {
      return remembered;
    }

    const flying = this.flights.get(key);

    if (flying !== undefined) {
      return (await flying) as T;
    }

    const flight = compute().then((found) => {
      this.remember(key, found);

      return found;
    });

    this.flights.set(key, flight);

    try {
      return await flight;
    } finally {
      this.flights.delete(key);
    }
  }

  private remembered<T>(key: string): T | undefined {
    const now = this.clock.now();

    this.memo = this.memo.filter(
      (entry) =>
        now - entry.at < (entry.found.ok ? MEMO_FOUND_MS : MEMO_FAILED_MS),
    );

    return this.memo.find((entry) => entry.key === key)?.found as T | undefined;
  }

  private remember(key: string, found: { ok: boolean }): void {
    this.memo.push({ key, at: this.clock.now(), found });

    while (this.memo.length > MEMO_LIMIT) {
      this.memo.shift();
    }
  }
}
