import type { Scratch } from "../../src/index.js";

export class FakeScratch implements Scratch {
  readonly folders = new Set<string>();
  readonly removed: string[] = [];
  readonly swept: number[] = [];
  private counter = 0;

  create(): string | null {
    this.counter += 1;

    const folder = `/scratch/recognizer-at-${this.counter}`;

    this.folders.add(folder);

    return folder;
  }

  remove(folder: string): void {
    this.folders.delete(folder);
    this.removed.push(folder);
  }

  sweepStale(maxAgeMs: number): void {
    this.swept.push(maxAgeMs);
  }
}
