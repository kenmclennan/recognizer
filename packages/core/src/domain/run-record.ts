export type PhaseName = "extract" | "describe" | "measure" | "sense";

export type RecordedPhaseName = PhaseName | "analysis";

export interface Diagnosis {
  suite?: string | null;
  code?: string | null;
  readonly [detail: string]: unknown;
}

export interface RunEntry {
  name: string;
  command: string[];
  status: number | null;
  outcome: "ok" | "failed" | "stopped";
  duration_ms: number;
  reason?: string;
  diagnosis?: Diagnosis;
  stderr: string;
}

export interface RunPhase {
  phase: RecordedPhaseName;
  entries: RunEntry[];
  duration_ms?: number;
}

export interface EventEntry {
  name: string;
  outcome: "ok" | "failed" | "stopped";
  reason?: string;
  diagnosis?: Diagnosis;
  modules?: number;
  edges?: number;
}

export interface SkippedPhase {
  phase: string;
  reason: string;
}

export interface RunSummary {
  commit: string | null;
  ran: PhaseName[];
}

export interface RunFailure {
  sensor: string;
  suite: string | null;
  code: string | null;
  reason: string;
}
