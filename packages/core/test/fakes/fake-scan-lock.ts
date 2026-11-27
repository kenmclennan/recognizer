import type {
  AcquiredLock,
  GapRecord,
  HeldLock,
  LockDetails,
  RunFailure,
  RunSummary,
  ScanEvent,
  ScanLock,
  ScanStatus,
} from "../../src/index.js";

export interface LockRecord {
  phase: "checking" | "running" | "refused" | "finished" | "failed";
  sensors: string[];
  describe: boolean;
  released: boolean;
  events: ScanEvent[];
  crashed: unknown;
}

export class FakeScanLock implements ScanLock {
  startedAt = 0;

  readonly locks: LockRecord[] = [];
  private holder: LockRecord | null = null;

  acquire(_root: string, details: LockDetails): AcquiredLock {
    if (this.holder !== null && !this.holder.released) {
      return {
        ok: false,
        text: `a scan is already running on the repository (${this.holder.phase})\n`,
      };
    }

    const record: LockRecord = {
      phase: "checking",
      sensors: details.sensors,
      describe: details.describe,
      released: false,
      events: [],
      crashed: null,
    };
    const lock: HeldLock = {
      startedAt: this.startedAt,
      append: (event) => {
        record.events.push(event);
      },
      running: () => {
        record.phase = "running";
      },
      refused: (_gaps: GapRecord[], _summary: RunSummary) => {
        record.phase = "refused";
      },
      end: (exit: number, _failure: RunFailure | null) => {
        record.phase = exit === 0 ? "finished" : "failed";
      },
      crashed: (error) => {
        record.crashed = error;
      },
      release: () => {
        record.released = true;
      },
      awaitAnswer: () => Promise.resolve(true),
    };

    this.locks.push(record);
    this.holder = record;

    return { ok: true, lock };
  }

  status(): ScanStatus {
    const record = this.holder;

    return record === null || record.released
      ? { running: false }
      : {
          running: true,
          phase: record.phase,
          sensors: record.sensors,
          describe: record.describe,
          startedBy: "cli",
        };
  }
}
