export interface Git {
  commit(root: string): string | null;
  dirty(root: string): boolean;
}
