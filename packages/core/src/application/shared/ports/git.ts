export interface NameStatusEntry {
  readonly status: "A" | "M" | "D" | "T" | "R";
  readonly path: string;
  readonly from?: string;
}

export interface WorkingTreeEntry {
  readonly code: string;
  readonly path: string;
}

export type GitText = { ok: true; text: string } | { ok: false; error: string };

export interface Git {
  commit(root: string): string | null;
  dirty(root: string): boolean;
  dirtyPaths(root: string): readonly string[] | null;
  resolveRef(root: string, ref: string): string | null;
  isAncestor(root: string, ancestor: string, descendant: string): boolean;
  renamesSince(root: string, commit: string): ReadonlyMap<string, string>;
  nameStatus(
    root: string,
    base: string,
    head: string,
  ): readonly NameStatusEntry[] | null;
  userName(root: string): string | null;
  showText(
    root: string,
    commit: string,
    path: string,
    limit: number,
  ): Promise<string | null>;
  archive(
    root: string,
    commit: string,
    paths: readonly string[],
    target: string,
  ): Promise<boolean>;
  branch(root: string): string | null;
  insideWorkTree(root: string): boolean;
  listFiles(root: string): readonly string[] | null;
  defaultRef(root: string): string | null;
  history(root: string, limit: number): Promise<GitText>;
  branches(root: string, limit: number): Promise<GitText>;
  branchCount(root: string): Promise<number | null>;
  mergeBase(root: string, a: string, b: string): Promise<string | null>;
  aheadBehind(
    root: string,
    base: string,
    head: string,
  ): Promise<{ behind: number; ahead: number } | null>;
  diffRefs(
    root: string,
    base: string,
    head: string,
  ): Promise<readonly NameStatusEntry[] | null>;
  commitDetail(root: string, ref: string): Promise<string | null>;
  tipSummary(root: string, ref: string): Promise<string | null>;
  stateSnapshot(root: string): Promise<string | null>;
  workingTree(root: string): Promise<readonly WorkingTreeEntry[] | null>;
}
