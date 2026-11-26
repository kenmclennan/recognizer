import {
  InvalidEntity,
  Run,
  type RunReport,
  type RunView,
} from "@recognizer/core";
import type { RunSnapshotPort } from "./rescanner";
import type { RunEvent } from "./scan-port";

export type FakeRunSnapshot = RunSnapshotPort & {
  publish: (run: RunView | null) => void;
  latest: () => RunView | null;
  report: (...reports: RunReport[]) => void;
};

export type RunFeed = {
  onRun: (handler: (event: RunEvent) => void) => () => void;
  onReport?: (handler: (report: RunReport) => void) => () => void;
};

type RunRecord = NonNullable<RunEvent["run"]>;

function begun(record: RunRecord): Run {
  return Run.begin({
    id: record.run_id,
    startedBy: record.started_by,
    startedAt: record.started_at,
    scope: { kind: "working-tree" },
    choices: {
      sensors: record.sensors,
      describe: record.describe,
      suites: record.suites,
    },
  });
}

export function fakeRunSnapshot(
  feed?: RunFeed,
  awake: () => number | null = () => null,
): FakeRunSnapshot {
  let held: RunView | null = null;
  let run: Run | null = null;
  const handlers = new Set<(run: RunView | null) => void>();

  const publish = (next: RunView | null) => {
    held = next;

    for (const handler of handlers) {
      handler(next);
    }
  };

  const apply = (report: RunReport) => {
    if (run === null) {
      return;
    }

    try {
      if (
        report.kind === "plugin-ended" &&
        (report.phase ?? "sense") === "sense" &&
        run.plugin(report.name).state === "queued"
      ) {
        run = run.apply(
          {
            kind: "plugin-started",
            name: report.name,
            progress: null,
          },
          awake(),
        );
      }

      run = run.apply(report, awake());
    } catch (error) {
      if (!(error instanceof InvalidEntity)) {
        throw error;
      }
    }
  };

  const report = (...reports: RunReport[]) => {
    for (const one of reports) {
      apply(one);
      publish(run === null ? null : run.view());
    }
  };

  feed?.onRun((event) => {
    const record = event.run;

    if (record === null) {
      run = null;
      publish(null);

      return;
    }

    if (run === null || run.id !== record.run_id) {
      run = begun(record);
    }

    const active = record.phase === "checking" || record.phase === "running";

    if (record.phase === "running" && run.state === "checking") {
      apply({ kind: "running" });
    }

    if (!active) {
      apply({
        kind: "ended",
        end: {
          state: record.phase as "finished" | "failed" | "stopped" | "refused",
          endedAt: record.ended_at,
          exit: record.exit,
          gaps: record.gaps,
          failure: record.failure,
          ran: record.ran,
        },
      });
    }

    publish(run.view());
  });

  feed?.onReport?.((one) => report(one));

  return {
    run: () => held,
    onRun(handler) {
      handlers.add(handler);

      return () => handlers.delete(handler);
    },
    publish,
    latest: () => held,
    report,
  };
}
