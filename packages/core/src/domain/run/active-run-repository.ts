import type { RunFailure } from "../run-record.js";
import type { RunScope } from "../run-scope.js";
import type { RunGap, RunReport, RunStarter } from "./run.js";

export type MarkerPhase =
  | "checking"
  | "refused"
  | "running"
  | "finished"
  | "failed"
  | "stopped";

export interface MarkerFacts {
  runId: string;
  startedBy: RunStarter;
  startedAt: string;
  scope: RunScope;
  sensors: string[];
  describe: boolean;
  suites: Record<string, string[]>;
  phase: MarkerPhase;
  endedAt: string | null;
  exit: number | null;
  gaps: RunGap[];
  failure: RunFailure | null;
  ran: string[] | null;
}

export type ActiveRunRead =
  | { kind: "none" }
  | { kind: "unreadable"; reason: string }
  | { kind: "live"; record: MarkerFacts; reports: RunReport[]; offset: number }
  | {
      kind: "ended";
      record: MarkerFacts;
      reports: RunReport[];
      offset: number;
    }
  | {
      kind: "killed";
      record: MarkerFacts;
      reports: RunReport[];
      offset: number;
    };

export interface ReadCursor {
  runId: string;
  offset: number;
}

export interface ActiveRunRepository {
  read(root: string, from: ReadCursor | null): ActiveRunRead;
  settleKilled(root: string, record: MarkerFacts): void;
}
