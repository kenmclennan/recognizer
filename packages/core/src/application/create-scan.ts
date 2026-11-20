import type { ScanOutcome, ScanRequest } from "../domain/index.js";
import { InvalidRequest } from "../domain/index.js";
import type { Scanners } from "../ports/driven/index.js";
import type { RunningScan, Scan } from "../ports/driving/scan.js";
import { EventQueue } from "./event-queue.js";
import { FlowContext } from "./flow-context.js";
import {
  type FlowPorts,
  type ScanAnswer,
  type ScanStep,
  scanFlow,
} from "./scan-flow.js";

export interface ScanPorts extends Omit<FlowPorts, "scanners"> {
  scanners: Scanners;
}

function toOutcome(error: unknown): ScanOutcome {
  return error instanceof InvalidRequest
    ? {
        status: "failed",
        reason: "invalid-request",
        messages: error.messages,
      }
    : { status: "failed", reason: "crashed", error };
}

async function perform(step: ScanStep, ports: ScanPorts): Promise<ScanAnswer> {
  if (step.kind === "extract") {
    return ports.scanners.extract(step.call);
  }

  if (step.kind === "sense") {
    await ports.sensors.run(step.call);

    return undefined;
  }

  if (step.kind === "parsers") {
    try {
      return await ports.sensors.loadParsers(step.languages);
    } catch (error) {
      return error as Error;
    }
  }

  return ports.describer.describe(step.call);
}

async function drive(
  request: ScanRequest,
  ports: ScanPorts,
  ctx: FlowContext,
): Promise<ScanOutcome> {
  const flow = scanFlow(request, ports, ctx);

  try {
    let step = flow.next();

    while (!step.done) {
      if (step.value.kind === "extract") {
        let answer: ScanAnswer;
        let failure: unknown;

        try {
          answer = await perform(step.value, ports);
        } catch (error) {
          failure = error ?? new Error("scanner failed");
        }

        step = failure === undefined ? flow.next(answer) : flow.throw(failure);
      } else {
        step = flow.next(await perform(step.value, ports));
      }
    }

    return ctx.stopped ? { status: "stopped" } : step.value;
  } catch (error) {
    return ctx.stopped ? { status: "stopped" } : toOutcome(error);
  } finally {
    flow.return({ status: "stopped" });
  }
}

export function createScan(ports: ScanPorts): Scan {
  return {
    start(request: ScanRequest): RunningScan {
      const queue = new EventQueue();
      const ctx = new FlowContext(true, (event) => queue.push(event));

      ctx.flush = () => queue.drained();

      const outcome = Promise.resolve()
        .then(() => drive(request, ports, ctx))
        .finally(() => queue.close());

      return {
        events: queue.iterable(),
        outcome,
        async stop() {
          ctx.stopped = true;
          await ports.process.stopAll();
          ctx.lock?.release();
        },
      };
    },
    status: (repository) => Promise.resolve(ports.store.status(repository)),
  };
}
