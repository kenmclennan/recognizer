import type { HistoryPorts } from "./history-ports.js";
import { type BranchRow, parseBranches } from "./history-rows.js";

export const BRANCH_LIMIT = 100;

export interface BranchesReply {
  readonly defaultRef: string | null;
  readonly total: number;
  readonly rows: BranchRow[];
  readonly skipped: number;
}

function lines(text: string): number {
  return text.split("\n").filter((line) => line !== "").length;
}

export async function listBranches(
  ports: HistoryPorts,
  root: string,
): Promise<BranchesReply> {
  const result = await ports.limiter.run(() =>
    ports.git.branches(root, BRANCH_LIMIT),
  );

  if (!result.ok) {
    throw new Error(result.error);
  }

  const counted = await ports.limiter.run(() => ports.git.branchCount(root));

  return {
    defaultRef: ports.git.defaultRef(root),
    total: Math.max(counted ?? 0, lines(result.text)),
    ...parseBranches(result.text),
  };
}
