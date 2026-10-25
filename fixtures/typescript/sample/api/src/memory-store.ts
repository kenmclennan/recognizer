import { readFileSync } from "node:fs";
import { BaseStore, makeBase } from "./base-store.js";
import type { Store } from "./types.js";

export class MemoryStore extends BaseStore implements Store {
  save(): void {}
}

export const load = (p: string) => readFileSync(p);

export const fresh = (): BaseStore => makeBase();

export enum Mode {
  Fast,
}
