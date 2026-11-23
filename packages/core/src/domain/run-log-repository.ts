import type { RunPhase, SkippedPhase } from "./run-record.js";

export interface RunLog {
  skip(phase: SkippedPhase): void;
  update(phases: RunPhase[]): void;
  finish(phases: RunPhase[], failed: boolean, analysisMs?: number): void;
  id(): string;
}

export interface RunLogRepository {
  open(
    root: string,
    startedAt: number,
    by: string | undefined,
    invocation: string[],
  ): RunLog;
}
