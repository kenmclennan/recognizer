import type { Id } from "./types.js";

const limit = 10;

export class BaseStore {
  ids: Id[] = [];
  size: number = 0;

  private grow(): number {
    return limit;
  }

  count(): number {
    return this.grow();
  }
}

export function makeBase(): BaseStore {
  return new BaseStore();
}
