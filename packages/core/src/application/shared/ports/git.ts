export interface Git {
  commit(root: string): string | null;
  dirty(root: string): boolean;
  resolveRef(root: string, ref: string): string | null;
  isAncestor(root: string, ancestor: string, descendant: string): boolean;
  renamesSince(root: string, commit: string): ReadonlyMap<string, string>;
}
