import type { Gap } from "./gap.js";

export type ScanOutcome =
  | { status: "finished" }
  | { status: "failed"; reason: "phases" }
  | { status: "failed"; reason: "invalid-request"; messages: string[] }
  | { status: "failed"; reason: "crashed"; error: unknown }
  | { status: "refused"; reason: "lock" }
  | { status: "refused"; reason: "preflight"; gaps: Gap[] }
  | { status: "stopped" };

export type ScanStatus =
  | { running: false }
  | {
      running: true;
      phase: string;
      sensors: string[];
      describe: boolean;
      startedBy: string;
    };
