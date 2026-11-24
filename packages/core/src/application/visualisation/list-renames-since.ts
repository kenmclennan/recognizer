import type { Git } from "../shared/ports/git.js";
import { validCommit } from "./internal/historical-scan.js";

export interface RenamedFile {
  from: string;
  to: string;
}

export function listRenamesSince(
  ports: { git: Git },
  root: string,
  commit: string,
): RenamedFile[] {
  if (!validCommit(commit)) {
    return [];
  }

  return [...ports.git.renamesSince(root, commit)].map(([from, to]) => ({
    from,
    to,
  }));
}
