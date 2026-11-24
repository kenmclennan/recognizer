import { ViewRange } from "../../domain/visualisation/view-range.js";
import type { Git, NameStatusEntry } from "../shared/ports/git.js";

export interface ChangeRange {
  baseCommit: string | null;
  headCommit: string | null;
  merged: boolean;
  changes: readonly NameStatusEntry[];
}

export function readChangeRange(
  ports: { git: Git },
  root: string,
  base: string,
  head: string,
): ChangeRange | null {
  const { git } = ports;

  if (
    !ViewRange.isValidRef(base) ||
    !ViewRange.isValidRef(head) ||
    git.commit(root) === null
  ) {
    return null;
  }

  const baseCommit = git.resolveRef(root, base);
  const headCommit = git.resolveRef(root, head);

  if (baseCommit === null || headCommit === null) {
    return { baseCommit, headCommit, merged: false, changes: [] };
  }

  const merged =
    headCommit !== baseCommit && git.isAncestor(root, headCommit, baseCommit);
  const changes = git.nameStatus(root, baseCommit, headCommit);

  return changes === null ? null : { baseCommit, headCommit, merged, changes };
}
