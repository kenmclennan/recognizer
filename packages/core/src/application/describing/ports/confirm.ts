import type { HeldLock } from "../../shared/ports/store.js";

export interface Confirm {
  ask(lock: HeldLock | null): Promise<boolean>;
}
