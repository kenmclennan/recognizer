import type { ScanRunRecord } from "recognizer";
import type { ScanPlan } from "./scan-panel-model";
import type {
  DescribingSettings,
  RunEvent,
  ScanPort,
  ScanRunResult,
  StoredTicks,
  WrittenTicks,
} from "./scan-port";
import { parseScanLine, type ScanEvent } from "./scan-progress";
import type { ScanReport } from "./scan-report";

export type ScanStep = string | Promise<void>;

export type FakeScan = ScanPort & {
  steps: ScanStep[];
  result: ScanRunResult;
  cache: ScanReport;
  defaults: { describe: boolean; sensors: boolean };
  describing: DescribingSettings;
  ran: ScanPlan[];
  stopped: number;
  answers: boolean[];
  written: WrittenTicks[];
  onStep: (index: number) => void;
  emitRun: (event: RunEvent) => void;
  watching: number;
  records: boolean;
  record: Partial<ScanRunRecord>;
};

const SPAWNS_NO_RECORD = new Set<ScanRunResult["status"]>([
  "command-missing",
  "refused",
]);

function passedPreflight(event: ScanEvent): boolean {
  switch (event.event) {
    case "preflight":
      return event.state === "ok";
    case "phase":
      return event.phase !== "extract";
    case "entry":
      return event.phase !== "extract";
    case "start":
    case "progress":
    case "confirm":
    case "answered":
    case "stopped":
      return true;
    case "summary":
      return false;
  }
}

const ENDED = "2026-11-10T09:00:05.000Z";

export function fakeScan(overrides: Partial<FakeScan> = {}): FakeScan {
  const runs = new Set<(event: RunEvent) => void>();
  let remembered: StoredTicks | null = null;
  let runCount = 0;
  const nextRun = () => {
    runCount += 1;

    return runCount;
  };
  let pending: { stop: () => void } | null = null;
  const fake: FakeScan = {
    steps: [],
    result: { status: "finished", exitCode: 0 },
    cache: {
      status: "scanned",
      exitCode: 0,
      stderr: "",
      scans: [],
      policy: null,
    },
    defaults: { describe: false, sensors: false },
    describing: { model: "haiku", batchSize: 4, confirmAboveUsd: 5 },
    ran: [],
    stopped: 0,
    answers: [],
    written: [],
    onStep: () => {},
    watching: 0,
    records: true,
    record: {},
    emitRun(event) {
      for (const handler of runs) {
        handler(event);
      }
    },
    async watchExternal() {
      fake.watching += 1;
    },
    onRun(handler) {
      runs.add(handler);

      return () => runs.delete(handler);
    },
    async run(plan) {
      if (pending !== null) {
        return { status: "refused", reason: "a scan is already running" };
      }

      fake.ran.push(plan);

      let halted = false;
      let release: () => void = () => {};
      const stopping = new Promise<void>((resolve) => {
        release = resolve;
      });

      pending = {
        stop: () => {
          halted = true;
          release();
        },
      };

      const writes =
        fake.records &&
        !SPAWNS_NO_RECORD.has(fake.result.status) &&
        !(fake.result.status === "gaps" && fake.steps.length === 0);
      let live: ScanRunRecord = {
        version: 4,
        run_id: `fake-run-${nextRun()}`,
        pid: 4242,
        pgid: 4242,
        started_at: "2026-11-10T09:00:00.000Z",
        started_by: "app",
        repository: "/work/repo",
        sensors: plan.sense,
        describe: plan.describe,
        commit: "abc1234",
        ran: null,
        ...fake.record,
        phase: "checking",
        ended_at: null,
        exit: null,
        gaps: [],
        failure: null,
      };
      const move = (changes: Partial<ScanRunRecord>) => {
        live = { ...live, ...changes };
        fake.emitRun({ kind: "run", run: live });
      };
      const endedAt = () => fake.record.ended_at ?? ENDED;
      const ranPhases = (): NonNullable<ScanRunRecord["ran"]> =>
        fake.record.ran ?? [
          "extract",
          ...(plan.describe ? (["describe"] as const) : []),
          ...(plan.sense.length > 0 ? (["sense"] as const) : []),
        ];
      const ends = (exit: number) => {
        const failure = fake.record.failure ?? null;

        if (exit === 4) {
          move({
            phase: "refused",
            exit,
            gaps:
              fake.record.gaps ??
              (fake.result.status === "gaps" ? fake.result.gaps : []),
            ended_at: endedAt(),
            ran: ranPhases(),
          });
        } else if (exit === 0) {
          move({
            phase: "finished",
            exit,
            ended_at: endedAt(),
            ran: ranPhases(),
          });
        } else {
          move({
            phase: "failed",
            exit,
            failure,
            ended_at: endedAt(),
            ran: ranPhases(),
          });
        }
      };
      let ended = false;

      try {
        if (writes) {
          fake.emitRun({ kind: "run", run: live });
        }

        for (const [index, step] of fake.steps.entries()) {
          if (halted) {
            break;
          }

          if (typeof step === "string") {
            fake.emitRun({ kind: "line", line: step });

            const event = parseScanLine(step);

            if (
              writes &&
              live.phase === "checking" &&
              event !== null &&
              passedPreflight(event)
            ) {
              move({ phase: "running" });
            }

            if (writes && event?.event === "summary") {
              ended = true;
              ends(event.exit ?? 0);
            }

            await new Promise((resolve) => setTimeout(resolve, 0));
          } else {
            await Promise.race([step, stopping]);
          }

          fake.onStep(index);
        }

        if (writes && !ended) {
          if (halted) {
            move({ phase: "stopped", exit: 143, ended_at: endedAt() });
          } else if (fake.result.status === "failed") {
            move({
              phase: "failed",
              exit: fake.result.exitCode,
              failure: fake.record.failure ?? null,
              ended_at: endedAt(),
              ran: ranPhases(),
            });
          } else if (fake.result.status === "finished") {
            ends(fake.result.exitCode);
          }
        }

        return halted ? { status: "stopped" } : fake.result;
      } finally {
        pending = null;
      }
    },
    async stop() {
      fake.stopped += 1;
      pending?.stop();
    },
    async answerDescribe(describe) {
      fake.answers.push(describe);
    },
    async readCache() {
      return fake.cache;
    },
    async readTicks() {
      return (
        remembered ?? {
          ...fake.defaults,
          ticked: fake.defaults.sensors ? null : [],
          remembered: false,
        }
      );
    },
    async writeTicks(ticks) {
      fake.written.push(ticks);
      remembered = { ...ticks, sensors: true, remembered: true };
    },
    async readDescribing() {
      return fake.describing;
    },
    ...overrides,
  };

  return fake;
}
