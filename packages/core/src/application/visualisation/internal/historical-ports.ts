import type { Limiter } from "../../shared/limiter.js";
import type { Clock } from "../../shared/ports/clock.js";
import type { Git } from "../../shared/ports/git.js";
import type { Scratch } from "../../shared/ports/scratch.js";
import type { MemoisedComparisons } from "../memoised-comparisons.js";
import type { ScanCache } from "../ports/scan-cache.js";

export interface HistoricalScanRequest {
  repository: string;
  mode: "incremental";
  sensors: null;
  describe: false;
  analysis: true;
  ignoreRetiredConfig: true;
  invocation: string[];
}

export interface HistoricalScanEvent {
  type: string;
  stream?: string;
  text?: string;
}

export type HistoricalScanOutcome =
  | { status: "finished" | "stopped" }
  | { status: "failed"; reason: "phases" }
  | { status: "failed"; reason: "invalid-request"; messages: string[] }
  | { status: "failed"; reason: "crashed"; error: unknown }
  | { status: "refused"; reason: "lock" }
  | { status: "refused"; reason: "preflight"; gaps: { line: string }[] };

export interface HistoricalScan {
  start(request: HistoricalScanRequest): {
    readonly events: AsyncIterable<HistoricalScanEvent>;
    readonly outcome: Promise<HistoricalScanOutcome>;
  };
}

export interface HistoricalPorts {
  git: Git;
  scratch: Scratch;
  scan: HistoricalScan;
  cache: ScanCache;
  clock: Clock;
  comparisons: MemoisedComparisons;
  limiter: Limiter;
}
