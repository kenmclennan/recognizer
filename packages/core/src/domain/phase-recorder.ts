import type {
  EventEntry,
  PhaseName,
  RunEntry,
  RunPhase,
} from "./run-record.js";

export type RecordedPhase = RunPhase & { phase: PhaseName };

export interface PhaseRecorder {
  start(phase: PhaseName): RecordedPhase;
  entry(
    phase: RecordedPhase,
    entry: RunEntry,
    extra?: Partial<EventEntry>,
    file?: string,
  ): void;
  skip(phase: string, reason: string): void;
  removed(file: string): void;
}
