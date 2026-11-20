import type {
  AcquiredLock,
  ConfigDocument,
  GapRecord,
  HeldLock,
  LockDetails,
  PolicyDocument,
  RunFailure,
  RunLog,
  RunPhase,
  RunSummary,
  ScanEvent,
  ScanStatus,
  SkippedPhase,
  Store,
} from "../../src/index.js";

export function cachePath(root: string, language: string): string {
  return `${root}/.recognizer/cache/scan.${language}.json`;
}

export interface LockRecord {
  phase: "checking" | "running" | "refused" | "finished" | "failed";
  sensors: string[];
  describe: boolean;
  released: boolean;
  events: ScanEvent[];
  crashed: unknown;
}

export class FakeStore implements Store {
  readonly files = new Map<string, string>();
  readonly locks: LockRecord[] = [];
  readonly runLogs: { skipped: SkippedPhase[]; phases: RunPhase[] }[] = [];
  private holder: LockRecord | null = null;

  isDirectory(): boolean {
    return true;
  }

  scannerSetup(): {
    scanners: Record<string, string>;
    install: Record<string, string>;
  } {
    return { scanners: {}, install: {} };
  }

  runConfig(): ConfigDocument | null {
    return null;
  }

  structureConfig(): ConfigDocument | null {
    return null;
  }

  readsSensorConfig(): boolean {
    return false;
  }

  policy(): PolicyDocument {
    return { policyDocument: true };
  }

  writeScan(root: string, language: string, bytes: string): void {
    this.files.set(cachePath(root, language), bytes);
  }

  remove(path: string): boolean {
    return this.files.delete(path);
  }

  removeStructureOutputs(): void {}

  openRunLog(): RunLog {
    const record = { skipped: [] as SkippedPhase[], phases: [] as RunPhase[] };

    this.runLogs.push(record);

    return {
      skip: (phase) => {
        record.skipped.push(phase);
      },
      update: (phases) => {
        record.phases = phases;
      },
      finish: (phases) => {
        record.phases = phases;
      },
      id: () => "log-1",
    };
  }

  acquireLock(_root: string, details: LockDetails): AcquiredLock {
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
