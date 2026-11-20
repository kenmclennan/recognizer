import type {
  ScanEvent,
  ScanOutcome,
  ScanRequest,
  ScanStatus,
} from "../../domain/index.js";

export interface RunningScan {
  readonly events: AsyncIterable<ScanEvent>;
  readonly outcome: Promise<ScanOutcome>;
  stop(): Promise<void>;
}

export interface Scan {
  start(request: ScanRequest): RunningScan;
  status(repository: string): Promise<ScanStatus>;
}
