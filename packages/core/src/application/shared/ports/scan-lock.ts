import type { GapRecord } from "../../../domain/gap.js";
import type { RunFailure, RunSummary } from "../../../domain/run-record.js";
import type { ScanEvent } from "../../../domain/scan-event.js";
import type { ScanStatus } from "../../../domain/scan-status.js";

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

export interface ScanLock {
  acquire(root: string, details: LockDetails): AcquiredLock;
  status(root: string): ScanStatus;
}
