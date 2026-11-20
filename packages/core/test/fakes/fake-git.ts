import type { Git } from "../../src/index.js";

export class FakeGit implements Git {
  constructor(
    private readonly head: string | null,
    public modified = false,
  ) {}

  commit(): string | null {
    return this.head;
  }

  dirty(): boolean {
    return this.modified;
  }
}
