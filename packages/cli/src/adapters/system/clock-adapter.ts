import type { Clock } from "@recognizer/core";
import type { Io } from "../../cli.js";

export class ClockAdapter implements Clock {
  constructor(private readonly io: Io) {}

  now(): number {
    return this.io.now();
  }

  awake(): number {
    return this.io.awake();
  }
}
