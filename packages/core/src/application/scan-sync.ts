import type { ScanEvent, ScanOutcome, ScanRequest } from "../domain/index.js";
import { InvalidRequest } from "../domain/index.js";
import type { ExtractResult, SyncScanners } from "../ports/driven/index.js";
import { FlowContext } from "./flow-context.js";
import { type FlowPorts, type ScanAnswer, scanFlow } from "./scan-flow.js";

export interface SyncPorts extends Omit<FlowPorts, "scanners"> {
  scanners: SyncScanners;
}

export function scanSync(
  request: ScanRequest,
  ports: SyncPorts,
  onEvent: (event: ScanEvent) => void,
): ScanOutcome {
  const ctx = new FlowContext(false, onEvent);
  const flow = scanFlow(request, ports, ctx);

  try {
    let step = flow.next();

    while (!step.done) {
      if (step.value.kind === "extract") {
        let result: ExtractResult | undefined;
        let failure: unknown;

        try {
          result = ports.scanners.extract(step.value.call);
        } catch (error) {
          failure = error ?? new Error("scanner failed");
        }

        step = failure === undefined ? flow.next(result) : flow.throw(failure);

        continue;
      }

      if (step.value.kind !== "parsers") {
        throw new Error("a synchronous scan cannot describe or sense");
      }

      step = flow.next(null as ScanAnswer);
    }

    return step.value;
  } catch (error) {
    return error instanceof InvalidRequest
      ? {
          status: "failed",
          reason: "invalid-request",
          messages: error.messages,
        }
      : { status: "failed", reason: "crashed", error };
  }
}
