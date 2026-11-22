import type { ScanEvent } from "../../../domain/scan-event.js";
import type { ScanOutcome, ScanStatus } from "../../../domain/scan-outcome.js";
import type { PlanRequest, ScanPlanView } from "../../../domain/scan-plan.js";
import type { ScanRequest } from "../../../domain/scan-request.js";

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
