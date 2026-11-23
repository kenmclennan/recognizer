import type { ChangeFacts } from "../../../domain/visualisation/stale-reason.js";
import type { ViewChange } from "../../../domain/visualisation/view.js";
import type { Git } from "../../shared/ports/git.js";

export function changeFacts(
  git: Git,
  root: string,
  change: ViewChange,
): ChangeFacts {
  const headCommit = git.resolveRef(root, change.head);
  const baseCommit = git.resolveRef(root, change.base);
  const merged =
    headCommit !== null &&
    baseCommit !== null &&
    headCommit !== baseCommit &&
    git.isAncestor(root, headCommit, baseCommit);

  return { headCommit, baseCommit, merged };
}
