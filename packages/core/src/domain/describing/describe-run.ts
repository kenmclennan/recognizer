import type { DescribeStop } from "../scan-event.js";

export const LIMIT_STATUS = 75;

export class DescribeRun {
  readonly threshold: number;
  #failuresInARow = 0;
  #stopped: DescribeStop | null = null;

  constructor(batchSize: number) {
    this.threshold = Math.max(batchSize, 2);
  }

  get stopped(): DescribeStop | null {
    return this.#stopped;
  }

  succeeded(): void {
    this.#failuresInARow = 0;
  }

  failed(module: string, reason: string, limit: boolean): boolean {
    this.#failuresInARow += 1;

    if (!limit && this.#failuresInARow < this.threshold) {
      return false;
    }

    this.#stopped = {
      cause: limit ? "limit" : "failures",
      module,
      reason,
      described: 0,
      not_described: [],
      threshold: this.threshold,
    };

    return true;
  }

  close(
    described: readonly string[],
    selected: readonly string[],
    failed: readonly string[],
  ): DescribeStop | null {
    const stop = this.#stopped;

    if (stop === null) {
      return null;
    }

    const failedIds = new Set(failed);

    stop.described = described.length;
    stop.not_described = selected
      .filter((id) => !described.includes(id) && !failedIds.has(id))
      .sort();

    return stop;
  }
}
