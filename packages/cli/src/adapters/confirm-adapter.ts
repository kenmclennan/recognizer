import type { Confirm, HeldLock } from "@recognizer/core";
import type { Io } from "../cli.js";

export class ConfirmAdapter implements Confirm {
  constructor(private readonly io: Io) {}

  async ask(lock: HeldLock | null): Promise<boolean> {
    if (lock === null) {
      return (await this.io.readLine())?.trim() === "describe";
    }

    return lock.awaitAnswer();
  }
}
