import { commandRefusal } from "recognizer";
import type {
  DoctorRead,
  SetupApplyOutcome,
  SetupApplyResult,
  SetupCheckResult,
  SetupPort,
} from "./setup-port";

export type FakeSetup = SetupPort & {
  doctor: DoctorRead;
  checkResult: SetupCheckResult;
  progress: string[];
  scanLive: boolean;
  failing: (argv: string[]) => { code: number; stderr: string } | null;
  calls: string[];
  ran: string[][];
  prompts: string[];
  budgets: (number | null)[];
  gate: Promise<void> | null;
  stopped: number;
};

export const CLEAN_DOCTOR: DoctorRead = {
  status: "ok",
  report: {
    repository: "/repo",
    ok: true,
    problems: 0,
    warnings: 0,
    areas: [],
  },
};

export function fakeSetup(options: Partial<FakeSetup> = {}): FakeSetup {
  let handler: ((line: string) => void) | null = null;
  let release: (() => void) | null = null;

  const fake: FakeSetup = {
    doctor: CLEAN_DOCTOR,
    checkResult: { status: "cancelled" },
    progress: [],
    scanLive: false,
    failing: () => null,
    calls: [],
    ran: [],
    prompts: [],
    budgets: [],
    gate: null,
    stopped: 0,
    ...options,
    async readDoctor() {
      fake.calls.push("read_doctor");

      return fake.doctor;
    },
    async check(prompt, _schema, budget) {
      fake.calls.push("run_setup_check");
      fake.prompts.push(prompt);
      fake.budgets.push(budget);

      if (fake.scanLive) {
        return { status: "refused", reason: "a scan is running" };
      }

      for (const line of fake.progress) {
        handler?.(line);
      }

      if (fake.gate !== null) {
        const stopped = new Promise<void>((resolve) => {
          release = resolve;
        });

        await Promise.race([fake.gate, stopped]);

        if (fake.stopped > 0) {
          return { status: "cancelled" };
        }
      }

      return fake.checkResult;
    },
    async apply(commands): Promise<SetupApplyResult> {
      fake.calls.push("apply_setup");

      const refused = commands
        .map((argv) => commandRefusal(argv))
        .find((reason) => reason !== null);

      let outcome: SetupApplyOutcome;

      if (refused !== undefined && refused !== null) {
        outcome = { status: "refused", reason: refused };
      } else if (fake.scanLive) {
        outcome = { status: "refused", reason: "a scan is running" };
      } else {
        outcome = {
          status: "applied",
          applied: commands.length,
          total: commands.length,
        };

        for (const [at, argv] of commands.entries()) {
          const failure = fake.failing(argv);

          if (failure !== null) {
            outcome = {
              status: "failed",
              applied: at,
              total: commands.length,
              command: argv,
              code: failure.code,
              stderr: failure.stderr,
            };
            break;
          }

          fake.ran.push(argv);
        }
      }

      return { outcome, doctor: fake.doctor };
    },
    async stop() {
      fake.calls.push("stop_setup");
      fake.stopped += 1;
      release?.();
    },
    onLine(next) {
      handler = next;

      return () => {
        handler = null;
      };
    },
  };

  return fake;
}
