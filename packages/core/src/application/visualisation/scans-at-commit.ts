import type { HistoricalPorts } from "./internal/historical-ports.js";
import {
  type Failed,
  notACommit,
  scanAt,
  validCommit,
} from "./internal/historical-scan.js";
import type { ScanFileText } from "./ports/scan-cache.js";

export type ScansAtCommit =
  | { ok: true; scans: readonly ScanFileText[] }
  | Failed;

export function scansAtCommit(
  ports: HistoricalPorts,
  root: string,
  commit: string,
): Promise<ScansAtCommit> {
  if (!validCommit(commit)) {
    return Promise.resolve(notACommit(commit));
  }

  return ports.comparisons.once(`${root}\0${commit}`, () =>
    scanAt(ports, root, commit, []),
  );
}
