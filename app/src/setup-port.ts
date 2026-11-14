import type { DoctorReport } from "recognizer";

export type DoctorRead =
  | { status: "ok"; report: DoctorReport }
  | { status: "unavailable"; reason: string };

export type SetupCheckResult =
  | {
      status: "proposal";
      output: unknown;
      costUsd: number | null;
      durationMs: number | null;
      denials: number;
    }
  | {
      status: "failed";
      reason: string;
      subtype: string | null;
      costUsd: number | null;
      durationMs: number | null;
    }
  | { status: "cancelled" }
  | { status: "refused"; reason: string }
  | { status: "unavailable"; reason: string };

export type SetupApplyOutcome =
  | { status: "applied"; applied: number; total: number }
  | {
      status: "failed";
      applied: number;
      total: number;
      command: string[];
      code: number | null;
      stderr: string;
    }
  | { status: "stopped"; applied: number; total: number }
  | { status: "refused"; reason: string };

export type SetupApplyResult = {
  outcome: SetupApplyOutcome;
  doctor: DoctorRead;
};

export type SetupPort = {
  readDoctor(): Promise<DoctorRead>;
  check(
    prompt: string,
    schema: unknown,
    budget: number | null,
  ): Promise<SetupCheckResult>;
  apply(commands: string[][]): Promise<SetupApplyResult>;
  stop(): Promise<void>;
  onLine(handler: (line: string) => void): () => void;
};
