import type { Responsibility } from "./responsibility.js";

export class Responsibilities {
  readonly #lines: Map<string, Responsibility>;

  constructor(lines: Iterable<readonly [string, Responsibility]> = []) {
    this.#lines = new Map(lines);
  }

  get(id: string): Responsibility | undefined {
    return this.#lines.get(id);
  }

  set(id: string, line: Responsibility): void {
    this.#lines.set(id, line);
  }

  remove(id: string): boolean {
    return this.#lines.delete(id);
  }

  ids(): string[] {
    return [...this.#lines.keys()].sort();
  }
}
