import type { Git } from "@recognizer/core";
import type { Io } from "../cli.js";
import { isDirty, resolveCommit } from "../scan-facts.js";

export class GitAdapter implements Git {
  constructor(private readonly io: Io) {}

  commit(root: string): string | null {
    return resolveCommit(this.io, root);
  }

  dirty(root: string): boolean {
    return isDirty(this.io, root);
  }
}
