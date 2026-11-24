import { type Git, type NameStatusEntry, ViewRange } from "../../src/index.js";

export class FakeGit implements Git {
  readonly refs = new Map<string, string>();
  readonly ancestors = new Set<string>();
  readonly renames = new Map<string, Map<string, string>>();
  readonly diffs = new Map<string, readonly NameStatusEntry[]>();
  readonly texts = new Map<string, string>();
  readonly archives = new Map<string, readonly string[]>();
  readonly calls: string[] = [];
  user: string | null = null;

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
    this.calls.push(`resolveRef ${ref}`);

    if (!ViewRange.isValidRef(ref)) {
      return null;
    }

    return this.refs.get(ref) ?? null;
  }

  isAncestor(_root: string, ancestor: string, descendant: string): boolean {
    this.calls.push(`isAncestor ${ancestor} ${descendant}`);

    return (
      ancestor === descendant || this.ancestors.has(`${ancestor}>${descendant}`)
    );
  }

  renamesSince(_root: string, commit: string): ReadonlyMap<string, string> {
    this.calls.push(`renamesSince ${commit}`);

    return this.renames.get(commit) ?? new Map<string, string>();
  }

  nameStatus(
    _root: string,
    base: string,
    head: string,
  ): readonly NameStatusEntry[] | null {
    this.calls.push(`nameStatus ${base} ${head}`);

    return this.diffs.get(`${base}...${head}`) ?? null;
  }

  userName(): string | null {
    return this.user;
  }

  async showText(
    _root: string,
    commit: string,
    path: string,
    limit: number,
  ): Promise<string | null> {
    const text = this.texts.get(`${commit}:${path}`);

    return text === undefined || Buffer.byteLength(text) > limit ? null : text;
  }

  async archive(
    _root: string,
    commit: string,
    paths: readonly string[],
    _target: string,
  ): Promise<boolean> {
    this.calls.push(`archive ${commit}`);

    if (!this.archives.has(commit)) {
      return false;
    }

    this.archived.push({ commit, paths });

    return true;
  }

  readonly archived: { commit: string; paths: readonly string[] }[] = [];
}
