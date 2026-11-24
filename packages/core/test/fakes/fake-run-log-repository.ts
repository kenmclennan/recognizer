import type {
  DescribeLog,
  KilledRun,
  RunEntry,
  RunLog,
  RunLogRepository,
  RunPhase,
  SkippedPhase,
} from "../../src/index.js";

export class FakeRunLogRepository implements RunLogRepository {
  readonly runLogs: { skipped: SkippedPhase[]; phases: RunPhase[] }[] = [];

  readonly describeRuns: {
    startedAt: number;
    by: string | undefined;
    invocation: string[];
    updates: RunEntry[][];
    entries: RunEntry[];
    finished: boolean;
    crashed: boolean;
  }[] = [];

  failClose = false;
  failSettles = 0;

  readonly settledKills: KilledRun[] = [];

  readonly records: {
    runId: string;
    outcome: "running" | "failed";
    stopped: string[];
  }[] = [];

  openRecord(runId: string): void {
    this.records.push({ runId, outcome: "running", stopped: [] });
  }

  settleKilled(_root: string, killed: KilledRun): void {
    if (this.failSettles > 0) {
      this.failSettles -= 1;

      throw new Error("the log directory cannot be written");
    }

    this.settledKills.push(killed);

    const open = this.records.find(
      (one) => one.runId === killed.runId && one.outcome === "running",
    );

    if (open === undefined) {
      this.records.push({
        runId: killed.runId,
        outcome: "failed",
        stopped: [...killed.running],
      });

      return;
    }

    open.outcome = "failed";
    open.stopped = [...killed.running];
  }

  openDescribe(
    _root: string,
    startedAt: number,
    by: string | undefined,
    invocation: string[],
  ): DescribeLog {
    const run = {
      startedAt,
      by,
      invocation,
      updates: [] as RunEntry[][],
      entries: [] as RunEntry[],
      finished: false,
      crashed: false,
    };

    this.describeRuns.push(run);

    return {
      update: (entries) => {
        run.updates.push([...entries]);
        run.entries = [...entries];
      },
      finish: (entries, crashed = false) => {
        if (crashed && this.failClose) {
          throw new Error("boom-close");
        }

        run.entries = [...entries];
        run.finished = true;
        run.crashed = crashed;
      },
    };
  }

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
