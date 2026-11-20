import type { ScanOutcome } from "../../../domain/scan-outcome.js";
import type { ScanRequest } from "../../../domain/scan-request.js";
import type { RunPhases } from "../phases.js";
import { type RunPorts, scanFlow } from "../scan-flow.js";
import type { FlowContext } from "./flow-context.js";
import { toOutcome } from "./outcome.js";

export async function drive(
  request: ScanRequest,
  ports: RunPorts,
  phases: RunPhases,
  ctx: FlowContext,
): Promise<ScanOutcome> {
  const flow = scanFlow(request, ports, phases, ctx);

  try {
    let step = flow.next();

    while (!step.done) {
      if (step.value.kind === "extract") {
        let answer: unknown;
        let failure: unknown;

        try {
          answer = await step.value.invoke();
        } catch (error) {
          failure = error ?? new Error("scanner failed");
        }

        step = failure === undefined ? flow.next(answer) : flow.throw(failure);
      } else {
        step = flow.next(await step.value.invoke());
      }
    }

    return ctx.stopped ? { status: "stopped" } : step.value;
  } catch (error) {
    return ctx.stopped ? { status: "stopped" } : toOutcome(error);
  } finally {
    flow.return({ status: "stopped" });
  }
}
