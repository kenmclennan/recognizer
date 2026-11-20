import type { Io } from "./cli.js";
import type { ConfigRead } from "./config-parse.js";
import { scanMain, scanSyncMain } from "./scan-main.js";

export type { ExtractInput } from "./adapters/plugins/scanners-adapter.js";
export {
  cacheFile,
  dirtyPaths,
  isDirty,
  readCachedScan,
  resolveCommit,
} from "./scan-facts.js";

export function runScanSync(argv: string[], io: Io, read: ConfigRead): number {
  return scanSyncMain(argv, io, read);
}

export function runScan(argv: string[], io: Io): Promise<number> {
  return scanMain(argv, io);
}
