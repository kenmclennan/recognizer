import type { ScanPlan } from "./scan-panel-model";
import type {
  ScanPort,
  ScanRunResult,
  StoredTicks,
  WrittenTicks,
} from "./scan-port";
import type { ScanReport } from "./scan-report";

export type ScanStep = string | Promise<void>;

export type FakeScan = ScanPort & {
  steps: ScanStep[];
  result: ScanRunResult;
  cache: ScanReport;
  defaults: { describe: boolean; sensors: boolean };
  ran: ScanPlan[];
  stopped: number;
  written: WrittenTicks[];
  onStep: (index: number) => void;
};

export function fakeScan(overrides: Partial<FakeScan> = {}): FakeScan {
  const handlers = new Set<(line: string) => void>();
  let remembered: StoredTicks | null = null;
  let pending: { stop: () => void } | null = null;
  const fake: FakeScan = {
    steps: [],
    result: { status: "finished", exitCode: 0, stderr: "", log: null },
    cache: {
      status: "scanned",
      exitCode: 0,
      stderr: "",
      scans: [],
      policy: null,
    },
    defaults: { describe: false, sensors: false },
    ran: [],
    stopped: 0,
    written: [],
    onStep: () => {},
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

      try {
        for (const [index, step] of fake.steps.entries()) {
          if (halted) {
            break;
          }

          if (typeof step === "string") {
            for (const handler of handlers) {
              handler(step);
            }

            await new Promise((resolve) => setTimeout(resolve, 0));
          } else {
            await Promise.race([step, stopping]);
          }

          fake.onStep(index);
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
    async readCache() {
      return fake.cache;
    },
    async readTicks() {
      return (
        remembered ?? {
          ...fake.defaults,
          ticked: null,
          remembered: false,
        }
      );
    },
    async writeTicks(ticks) {
      fake.written.push(ticks);
      remembered = { ...ticks, remembered: true };
    },
    onLine(handler) {
      handlers.add(handler);

      return () => handlers.delete(handler);
    },
    ...overrides,
  };

  return fake;
}
