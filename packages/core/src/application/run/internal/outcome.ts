import type { ScanOutcome } from "../../../domain/run/scan-outcome.js";
import { InvalidRequest } from "../../../domain/run/scan-request.js";

export function toOutcome(error: unknown): ScanOutcome {
  return error instanceof InvalidRequest
    ? {
        status: "failed",
        reason: "invalid-request",
        messages: error.messages,
      }
    : { status: "failed", reason: "crashed", error };
}
