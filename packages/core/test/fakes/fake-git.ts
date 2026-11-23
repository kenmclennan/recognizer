import { type Git, ViewRange } from "../../src/index.js";

export class FakeGit implements Git {
  readonly refs = new Map<string, string>();
  readonly ancestors = new Set<string>();
  readonly renames = new Map<string, Map<string, string>>();

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

  resolveRef(_root: string, ref: string): string | null {
    if (!ViewRange.isValidRef(ref)) {
      return null;
    }

    return this.refs.get(ref) ?? null;
  }

  isAncestor(_root: string, ancestor: string, descendant: string): boolean {
    return (
      ancestor === descendant || this.ancestors.has(`${ancestor}>${descendant}`)
    );
  }

  renamesSince(_root: string, commit: string): ReadonlyMap<string, string> {
    return this.renames.get(commit) ?? new Map<string, string>();
  }
}
