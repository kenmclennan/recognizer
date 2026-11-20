import type { ScanOutcome } from "../../../domain/scan-outcome.js";
import { InvalidRequest } from "../../../domain/scan-request.js";

export function toOutcome(error: unknown): ScanOutcome {
  return error instanceof InvalidRequest
    ? {
        status: "failed",
        reason: "invalid-request",
        messages: error.messages,
      }
    : { status: "failed", reason: "crashed", error };
}
