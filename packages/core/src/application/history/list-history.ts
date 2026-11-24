import type { HistoryPorts } from "./history-ports.js";

export const HISTORY_LIMIT = 200;

export interface HistoryReply {
  readonly branch: string | null;
  readonly text: string;
}

export async function listHistory(
  ports: HistoryPorts,
  root: string,
): Promise<HistoryReply> {
  const result = await ports.limiter.run(() =>
    ports.git.history(root, HISTORY_LIMIT),
  );

  if (!result.ok) {
    throw new Error(result.error);
  }

  return { branch: ports.git.branch(root), text: result.text };
}
