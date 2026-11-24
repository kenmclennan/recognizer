export type SetupLine = {
  event: "step";
  step: "survey" | "scan" | "reading";
  state: "run" | "done";
};

export type ApplyEvent<Doctor = unknown> =
  | { event: "start"; total: number; commands: number }
  | {
      event: "command";
      index: number;
      step: number;
      steps: number;
      command: string;
      state: "running" | "done";
    }
  | { event: "doctor"; state: "running" | "done" }
  | {
      event: "change";
      index: number;
      state: "running" | "done" | "failed" | "undone";
      output: string;
    }
  | { event: "result"; ok: boolean; doctor: Doctor | null };

export type TryEvent =
  | { event: "start"; total: number }
  | {
      event: "change";
      index: number;
      state: "running" | "done" | "failed" | "undone";
      output: string;
    }
  | {
      event: "runner";
      name: string;
      ready: boolean;
      detail: string;
      output: string;
    }
  | { event: "result"; ok: boolean };

export interface SetupEntry {
  name: string;
  command: string[];
  status: number | null;
  durationMs: number;
  output: string;
  reason?: string;
}

export type SetupRunOutcome<Result> =
  | { status: "refused"; reason: string }
  | { status: "finished"; ok: boolean; result: Result };
