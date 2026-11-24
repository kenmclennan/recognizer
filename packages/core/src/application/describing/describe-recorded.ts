import type { DescribeLog } from "../../domain/run-log-repository.js";
import type { RunEntry } from "../../domain/run-record.js";
import type { DescribeResult } from "../../domain/scan-event.js";
import {
  type DescribeModulesRequest,
  describeModules,
} from "./describe-modules.js";
import type { DescribingPorts } from "./internal/describing-ports.js";

export type DescribeRecordedRequest = DescribeModulesRequest & {
  by: string | undefined;
  invocation: string[];
};

export async function describeRecorded(
  ports: DescribingPorts,
  request: DescribeRecordedRequest,
): Promise<DescribeResult> {
  const startedAt = ports.clock.now();
  const recorded: RunEntry[] = [];
  let log: DescribeLog | null = null;

  let result: DescribeResult;

  try {
    result = await describeModules(ports, {
      ...request,
      onStart: (total) => {
        if (total > 0) {
          log = ports.runLog.openDescribe(
            request.root,
            startedAt,
            request.by,
            request.invocation,
          );
        }

        request.onStart?.(total);
      },
      onEntry: (entry) => {
        recorded.push(entry);
        (log as DescribeLog | null)?.update(recorded);
        request.onEntry?.(entry);
      },
    });
  } catch (error) {
    try {
      (log as DescribeLog | null)?.finish(recorded, true);
    } catch {
      throw error;
    }

    throw error;
  }

  (log as DescribeLog | null)?.finish(recorded);

  return result;
}
