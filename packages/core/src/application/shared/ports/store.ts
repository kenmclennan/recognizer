import type { ConfigDocument } from "../../../domain/config-document.js";
import type { GapRecord } from "../../../domain/gap.js";
import type { PolicyDocument } from "../../../domain/policy-document.js";
import type {
  RunFailure,
  RunPhase,
  RunSummary,
  SkippedPhase,
} from "../../../domain/run-record.js";
import type { ScanEvent } from "../../../domain/scan-event.js";
import type { ScanStatus } from "../../../domain/scan-outcome.js";

export interface HeldLock {
  append(event: ScanEvent): void;
  running(): void;
  refused(gaps: GapRecord[], summary: RunSummary): void;
  end(exit: number, failure: RunFailure | null, summary: RunSummary): void;
  crashed(error: unknown): void;
  release(): void;
  awaitAnswer(): Promise<boolean>;
}

export type AcquiredLock =
  | { ok: true; lock: HeldLock }
  | { ok: false; text: string };

export interface LockDetails {
  sensors: string[];
  describe: boolean;
  suites?: Record<string, string[]>;
}

export interface RunLog {
  skip(phase: SkippedPhase): void;
  update(phases: RunPhase[]): void;
  finish(phases: RunPhase[], failed: boolean, analysisMs?: number): void;
  id(): string;
}

export interface Store {
  isDirectory(root: string): boolean;
  scannerSetup(root: string): {
    scanners: Record<string, string>;
    install: Record<string, string>;
  };
  runConfig(root: string, skipRetired: boolean): ConfigDocument | null;
  analysisConfig(root: string, skipRetired: boolean): ConfigDocument | null;
  readsSensorConfig(): boolean;
  policy(root: string): PolicyDocument;
  writeScan(root: string, language: string, bytes: string): void;
  remove(path: string): boolean;
  removeAnalysisOutputs(root: string, off: boolean): void;
  openRunLog(
    root: string,
    startedAt: number,
    by: string | undefined,
    invocation: string[],
  ): RunLog;
  acquireLock(root: string, details: LockDetails): AcquiredLock;
  status(root: string): ScanStatus;
}
