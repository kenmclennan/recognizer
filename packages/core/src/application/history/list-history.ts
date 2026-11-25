import type { HistoryPorts } from "./history-ports.js";
import { type HistoryRow, parseHistory } from "./history-rows.js";

export const HISTORY_LIMIT = 200;

export interface HistoryReply {
  readonly branch: string | null;
  readonly rows: HistoryRow[];
  readonly skipped: number;
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

  return { branch: ports.git.branch(root), ...parseHistory(result.text) };
}
