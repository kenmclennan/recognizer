import type { ScanOutcome } from "../../../domain/scan-outcome.js";
import type { ScanRequest } from "../../../domain/scan-request.js";
import type { RunPhases } from "../phases.js";
import { type RunPorts, scanFlow } from "../scan-flow.js";
import type { FlowContext } from "./flow-context.js";
import { toOutcome } from "./outcome.js";

export function driveSync(
  request: ScanRequest,
  ports: RunPorts,
  phases: RunPhases,
  ctx: FlowContext,
): ScanOutcome {
  const flow = scanFlow(request, ports, phases, ctx);

  try {
    let step = flow.next();

    while (!step.done) {
      const { kind, invoke } = step.value;

      if (kind === "describe" || kind === "sense") {
        throw new Error("a synchronous scan cannot describe or sense");
      }

      if (kind === "extract") {
        let answer: unknown;
        let failure: unknown;

        try {
          answer = invoke();
        } catch (error) {
          failure = error ?? new Error("scanner failed");
        }

        step = failure === undefined ? flow.next(answer) : flow.throw(failure);

        continue;
      }

      step = flow.next(invoke());
    }

    return step.value;
  } catch (error) {
    return toOutcome(error);
  }
}
