import type {
  RunPhase as CoreRunPhase,
  DescribeLog,
  RunLog,
  RunLogRepository,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { openPhasedRunLog, openRunLog } from "../../run-log.js";

export class RunLogAdapter implements RunLogRepository {
  constructor(private readonly io: Io) {}

  open(
    root: string,
    startedAt: number,
    by: string | undefined,
    invocation: string[],
  ): RunLog {
    const log = openPhasedRunLog(this.io, root, startedAt, by, invocation);
    const recorded = (phases: CoreRunPhase[]) =>
      phases.map((phase) =>
        phase.phase === "analysis" ? { ...phase, phase: "structure" } : phase,
      ) as unknown as Parameters<typeof log.update>[0];

    return {
      skip: (phase) => log.skip(phase),
      update: (phases) => log.update(recorded(phases)),
      finish: (phases, failed, analysisMs) =>
        log.finish(recorded(phases), failed, analysisMs),
      id: () => log.id() as string,
    };
  }

  openDescribe(
    root: string,
    startedAt: number,
    by: string | undefined,
    invocation: string[],
  ): DescribeLog {
    const log = openRunLog(
      this.io,
      root,
      "describe",
      startedAt,
      by,
      invocation,
    );
    const recorded = (entries: unknown) =>
      entries as Parameters<typeof log.update>[0];

    return {
      update: (entries) => log.update(recorded(entries)),
      finish: (entries, crashed) => log.finish(recorded(entries), crashed),
    };
  }
}
