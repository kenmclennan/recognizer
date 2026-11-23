import type {
  RunLog,
  RunLogRepository,
  RunPhase,
  SkippedPhase,
} from "../../src/index.js";

export class FakeRunLogRepository implements RunLogRepository {
  readonly runLogs: { skipped: SkippedPhase[]; phases: RunPhase[] }[] = [];

  open(): RunLog {
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
}
