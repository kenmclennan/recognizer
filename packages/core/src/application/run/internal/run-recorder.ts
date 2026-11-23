import type {
  PhaseRecorder,
  RecordedPhase,
} from "../../../domain/phase-recorder.js";
import type { RunLog } from "../../../domain/run-log-repository.js";
import type {
  EventEntry,
  PhaseName,
  RunEntry,
  RunPhase,
  RunSummary,
  SkippedPhase,
} from "../../../domain/run-record.js";
import type { ScanSink } from "../../../domain/scan-sink.js";

function eventEntry(entry: RunEntry): EventEntry {
  return {
    name: entry.name,
    outcome: entry.outcome,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    ...(entry.diagnosis === undefined ? {} : { diagnosis: entry.diagnosis }),
  };
}

export class RunRecorder implements PhaseRecorder {
  failed = false;
  readonly removedFiles: string[] = [];
  readonly skipped: SkippedPhase[] = [];
  private readonly phases: RecordedPhase[] = [];
  private readonly summary = new Map<PhaseName, EventEntry[]>();
  private analysisPhase: RunPhase | null = null;

  constructor(
    private readonly sink: ScanSink,
    readonly runLog: RunLog | null,
  ) {}

  start(phase: PhaseName): RecordedPhase {
    const one: RecordedPhase = { phase, entries: [] };

    this.phases.push(one);
    this.summary.set(phase, []);
    this.sink.emit({ type: "phase-started", phase });

    return one;
  }

  entry(
    phase: RecordedPhase,
    entry: RunEntry,
    extra: Partial<EventEntry> = {},
    file?: string,
  ): void {
    const shown = { ...eventEntry(entry), ...extra };

    phase.entries.push(entry);
    this.summary.get(phase.phase)?.push(shown);
    this.runLog?.update(this.recorded());

    this.sink.emit({
      type: "entry",
      phase: phase.phase,
      entry: shown,
      ...(file === undefined ? {} : { file }),
    });

    if (entry.outcome === "failed") {
      this.failed = true;
    }
  }

  skip(phase: string, reason: string): void {
    this.skipped.push({ phase, reason });
    this.runLog?.skip({ phase, reason });
  }

  removed(file: string): void {
    this.removedFiles.push(file);
  }

  analysis(phase: RunPhase | null): void {
    this.analysisPhase = phase;
  }

  recorded(): RunPhase[] {
    if (this.analysisPhase === null) {
      return this.phases;
    }

    const at = this.phases.findIndex((one) => one.phase === "extract") + 1;

    return [
      ...this.phases.slice(0, at),
      this.analysisPhase,
      ...this.phases.slice(at),
    ];
  }

  ranSummary(commit: string | null): RunSummary {
    return {
      commit,
      ran: this.phases
        .filter((one) => (this.summary.get(one.phase) ?? []).length > 0)
        .map((one) => one.phase),
    };
  }

  summaryEvent(
    exit: 0 | 1 | 4,
    repository: string,
    commit: string | null,
    modified: boolean | null,
  ): void {
    this.sink.emit({
      type: "summary",
      repository,
      commit,
      modified,
      exit,
      phases: this.phases.map((one) => ({
        phase: one.phase,
        entries: this.summary.get(one.phase) ?? [],
      })),
      removed: this.removedFiles,
      skipped: this.skipped,
      log: this.runLog?.id() ?? null,
    });
  }

  firstFailed(): EventEntry | undefined {
    return this.phases
      .flatMap((one) => this.summary.get(one.phase) ?? [])
      .find((entry) => entry.outcome === "failed");
  }
}
