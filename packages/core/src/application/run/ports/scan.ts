import type { ScanOutcome } from "../../../domain/run/scan-outcome.js";
import type {
  PlanRequest,
  ScanPlanView,
} from "../../../domain/run/scan-plan.js";
import type { ScanRequest } from "../../../domain/run/scan-request.js";
import type { ScanEvent } from "../../../domain/scan-event.js";
import type { ScanStatus } from "../../../domain/scan-status.js";

export interface RunningScan {
  readonly events: AsyncIterable<ScanEvent>;
  readonly outcome: Promise<ScanOutcome>;
  stop(): Promise<void>;
}

export interface Scan {
  start(request: ScanRequest): RunningScan;
  status(repository: string): Promise<ScanStatus>;
  plan(request: PlanRequest): Promise<ScanPlanView>;
}
