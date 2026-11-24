export interface NameStatusEntry {
  readonly status: "A" | "M" | "D" | "T" | "R";
  readonly path: string;
  readonly from?: string;
}

export interface Git {
  commit(root: string): string | null;
  dirty(root: string): boolean;
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
}
