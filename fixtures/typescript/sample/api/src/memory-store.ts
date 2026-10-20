import { readFileSync } from "node:fs";
import { BaseStore } from "./base-store.js";
import type { Store } from "./types.js";

export class MemoryStore extends BaseStore implements Store {
  save(): void {}
}

export const load = (p: string) => readFileSync(p);

export enum Mode {
  Fast,
}
