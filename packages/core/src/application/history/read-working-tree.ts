import type { Limiter } from "../shared/limiter.js";
import type { Git, WorkingTreeEntry } from "../shared/ports/git.js";

export interface WorkingTreePorts {
  readonly git: Git;
  readonly limiter: Limiter;
}

export interface WorkingTreeReply {
  readonly entries: readonly WorkingTreeEntry[];
}

export async function readWorkingTree(
  ports: WorkingTreePorts,
  root: string,
): Promise<WorkingTreeReply> {
  const entries = await ports.limiter.run(() => ports.git.workingTree(root));

  return { entries: entries ?? [] };
}
