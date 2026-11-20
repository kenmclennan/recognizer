import type { Clock } from "../../src/index.js";

export class FakeClock implements Clock {
  private time = 1_000;

  advance(ms: number): void {
    this.time += ms;
  }

  now(): number {
    return this.time;
  }

  awake(): number {
    this.time += 1;

    return this.time;
  }
}
