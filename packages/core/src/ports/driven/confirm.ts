import type { HeldLock } from "./store.js";

export interface Confirm {
  ask(lock: HeldLock | null): Promise<boolean>;
}
