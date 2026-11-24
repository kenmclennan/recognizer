import type { RunEntry, RunPhase, SkippedPhase } from "./run-record.js";

export interface RunLog {
  skip(phase: SkippedPhase): void;
  update(phases: RunPhase[]): void;
  finish(phases: RunPhase[], failed: boolean, analysisMs?: number): void;
  stop(phases: RunPhase[], analysisMs?: number): void;
  id(): string;
}

export interface DescribeLog {
  update(entries: RunEntry[]): void;
  finish(entries: RunEntry[], crashed?: boolean): void;
}

export interface KilledRun {
  runId: string;
  startedAt: string;
  startedBy: string;
  running: string[];
}

export interface RunLogRepository {
  open(
    root: string,
    startedAt: number,
    by: string | undefined,
    invocation: string[],
  ): RunLog;
  openDescribe(
    root: string,
    startedAt: number,
    by: string | undefined,
    invocation: string[],
  ): DescribeLog;
  settleKilled(root: string, killed: KilledRun): void;
}
