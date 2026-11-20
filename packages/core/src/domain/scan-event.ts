import type { Gap } from "./gap.js";
import type { EventEntry, PhaseName, SkippedPhase } from "./run-record.js";

export interface Projection {
  modules: number;
  cost_usd: number | null;
  readonly [detail: string]: unknown;
}

export interface DescribeStop {
  cause: "limit" | "failures";
  module: string;
  reason: string;
  described: number;
  not_described: string[];
  threshold: number;
}

export interface DescribeResult {
  stopped: DescribeStop | null;
  readonly [detail: string]: unknown;
}

export type PluginProgress = { readonly [field: string]: unknown };

export type PhaseDetail =
  | {
      state: "run";
      commit: string | null;
      reason: string;
      languages?: readonly string[];
    }
  | { state: "current"; commit: string }
  | { total: number };

export interface SummaryPhase {
  phase: PhaseName;
  entries: EventEntry[];
}

export type ScanEvent =
  | { type: "preflight"; state: "run" }
  | { type: "preflight"; state: "ok" }
  | { type: "preflight"; state: "gaps"; gaps: Gap[] }
  | { type: "phase-started"; phase: PhaseName }
  | { type: "phase"; phase: PhaseName; detail: PhaseDetail }
  | { type: "start"; phase: PhaseName; name: string }
  | { type: "plugin"; phase: PhaseName; name: string; data: PluginProgress }
  | { type: "entry"; phase: PhaseName; entry: EventEntry; file?: string }
  | { type: "structure"; state: "run" | "done" | "failed"; files?: number }
  | { type: "projection"; projection: Projection }
  | { type: "confirmation-asked"; projection: Projection }
  | { type: "confirmation-answered"; describe: boolean }
  | { type: "describing-stopped"; stop: DescribeStop }
  | { type: "describing-finished"; result: DescribeResult }
  | {
      type: "notice";
      stream: "stdout" | "stderr";
      text: string;
      humanOnly: boolean;
    }
  | {
      type: "summary";
      repository: string;
      commit: string | null;
      modified: boolean | null;
      exit: 0 | 1 | 4;
      phases: SummaryPhase[];
      removed: string[];
      skipped: SkippedPhase[];
      log: string | null;
    };
