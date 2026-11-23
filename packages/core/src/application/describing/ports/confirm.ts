import type { HeldLock } from "../../shared/ports/scan-lock.js";

export interface Confirm {
  ask(lock: HeldLock | null): Promise<boolean>;
}
