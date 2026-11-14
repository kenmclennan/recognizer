import {
  type DroppedChange,
  parseProposal,
  SETUP_SCHEMA,
  type SetupChange,
  type SetupSection,
} from "recognizer";
import { budgetFor } from "./setup-estimate";
import type { DoctorRead, SetupApplyOutcome, SetupPort } from "./setup-port";
import { buildPrompt } from "./setup-prompt";

export const SECTION_ORDER: SetupSection[] = ["problems", "tests", "policy"];

export const SECTION_NAMES: Record<SetupSection, string> = {
  problems: "Problems",
  tests: "Test suites",
  policy: "Policy",
};

export type ReportState = {
  kind: "report";
  summary: string;
  changes: SetupChange[];
  dropped: DroppedChange[];
  ticks: boolean[];
  section: SetupSection | null;
  costUsd: number | null;
  durationMs: number | null;
};

export type SetupState =
  | { kind: "start"; doctor: DoctorRead | null; model: string }
  | { kind: "checking"; lines: string[] }
  | ReportState
  | { kind: "applying"; report: ReportState }
  | {
      kind: "applied";
      report: ReportState;
      outcome: SetupApplyOutcome;
      doctor: DoctorRead;
    }
  | {
      kind: "error";
      message: string;
      detail: string | null;
      costUsd: number | null;
      durationMs: number | null;
    };

export function doctorProblems(read: DoctorRead | null): number | null {
  return read !== null && read.status === "ok" ? read.report.problems : null;
}

export function sectionsOf(report: ReportState): SetupSection[] {
  return SECTION_ORDER.filter((section) =>
    report.changes.some((change) => change.section === section),
  );
}

export function sectionCounts(
  report: ReportState,
  section: SetupSection,
): { ticked: number; total: number } {
  let ticked = 0;
  let total = 0;

  report.changes.forEach((change, at) => {
    if (change.section === section) {
      total += 1;

      if (report.ticks[at]) {
        ticked += 1;
      }
    }
  });

  return { ticked, total };
}

export function tickedCommands(report: ReportState): string[][] {
  return report.changes.flatMap((change, at) =>
    report.ticks[at] ? change.commands : [],
  );
}

export function canApply(state: SetupState): boolean {
  return (
    state.kind === "report" &&
    state.changes.some((_, at) => state.ticks[at] === true)
  );
}

export type SetupController = {
  state(): SetupState;
  subscribe(listener: (state: SetupState) => void): () => void;
  open(): Promise<void>;
  check(): Promise<void>;
  cancel(): Promise<void>;
  toggle(index: number): void;
  select(section: SetupSection): void;
  apply(): Promise<void>;
  stop(): Promise<void>;
  back(): void;
};

export type SetupDeps = {
  port: SetupPort;
  readModel: () => Promise<string>;
  onDoctor?: (read: DoctorRead) => void;
};

function reportOf(
  output: unknown,
  costUsd: number | null,
  durationMs: number | null,
): SetupState {
  const parsed = parseProposal(output);

  if ("error" in parsed) {
    return {
      kind: "error",
      message: parsed.error,
      detail: null,
      costUsd,
      durationMs,
    };
  }

  const first = SECTION_ORDER.find((section) =>
    parsed.changes.some((change) => change.section === section),
  );

  return {
    kind: "report",
    summary: parsed.summary,
    changes: parsed.changes,
    dropped: parsed.dropped,
    ticks: parsed.changes.map((change) => change.ticked),
    section: first ?? null,
    costUsd,
    durationMs,
  };
}

export function createSetupController(deps: SetupDeps): SetupController {
  let state: SetupState = { kind: "start", doctor: null, model: "" };
  const listeners = new Set<(state: SetupState) => void>();

  function set(next: SetupState): void {
    state = next;

    for (const listener of listeners) {
      listener(state);
    }
  }

  let begun: { doctor: DoctorRead | null; model: string } = {
    doctor: null,
    model: "",
  };

  function begin(doctor: DoctorRead | null, model: string): void {
    begun = { doctor, model };
    set({ kind: "start", doctor, model });
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    async open() {
      const model = await deps.readModel();

      begin(null, model);

      const doctor = await deps.port.readDoctor();

      deps.onDoctor?.(doctor);

      if (state.kind === "start") {
        begin(doctor, model);
      }
    },
    async check() {
      if (state.kind !== "start") {
        return;
      }

      const { doctor, model } = begun;

      set({ kind: "checking", lines: [] });

      const off = deps.port.onLine((line) => {
        if (state.kind === "checking") {
          set({ kind: "checking", lines: [...state.lines, line] });
        }
      });

      try {
        const result = await deps.port.check(
          buildPrompt(doctor),
          SETUP_SCHEMA,
          budgetFor(model),
        );

        if (result.status === "proposal") {
          set(reportOf(result.output, result.costUsd, result.durationMs));
        } else if (result.status === "failed") {
          set({
            kind: "error",
            message: result.reason,
            detail: result.subtype,
            costUsd: result.costUsd,
            durationMs: result.durationMs,
          });
        } else if (result.status === "cancelled") {
          begin(doctor, model);
        } else {
          set({
            kind: "error",
            message: result.reason,
            detail: null,
            costUsd: null,
            durationMs: null,
          });
        }
      } catch (error) {
        set({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
          detail: null,
          costUsd: null,
          durationMs: null,
        });
      } finally {
        off();
      }
    },
    async cancel() {
      if (state.kind === "checking") {
        await deps.port.stop();
      }
    },
    toggle(index) {
      if (state.kind !== "report" || index < 0 || index >= state.ticks.length) {
        return;
      }

      const ticks = state.ticks.map((on, at) => (at === index ? !on : on));

      set({ ...state, ticks });
    },
    select(section) {
      if (state.kind === "report") {
        set({ ...state, section });
      }
    },
    async apply() {
      if (state.kind !== "report" || !canApply(state)) {
        return;
      }

      const report = state;

      set({ kind: "applying", report });

      try {
        const result = await deps.port.apply(tickedCommands(report));

        deps.onDoctor?.(result.doctor);
        set({
          kind: "applied",
          report,
          outcome: result.outcome,
          doctor: result.doctor,
        });
      } catch (error) {
        set({
          kind: "applied",
          report,
          outcome: {
            status: "refused",
            reason: error instanceof Error ? error.message : String(error),
          },
          doctor: { status: "unavailable", reason: "the apply did not finish" },
        });
      }
    },
    async stop() {
      if (state.kind === "applying") {
        await deps.port.stop();
      }
    },
    back() {
      if (state.kind === "applied") {
        set(state.report);
      } else if (state.kind === "error") {
        begin(begun.doctor, begun.model);
      }
    },
  };
}

export function runSummary(
  costUsd: number | null,
  durationMs: number | null,
): string {
  const parts: string[] = [];

  if (durationMs !== null) {
    parts.push(
      durationMs < 60_000
        ? `${Math.max(1, Math.round(durationMs / 1000))} s`
        : `${Math.floor(durationMs / 60_000)} min ${Math.round((durationMs % 60_000) / 1000)} s`,
    );
  }

  if (costUsd !== null) {
    parts.push(`$${costUsd.toFixed(2)}`);
  }

  return parts.join(" - ");
}

export function doctorLines(read: DoctorRead | null): string[] {
  if (read === null) {
    return ["Reading recognizer doctor..."];
  }

  if (read.status === "unavailable") {
    return [`Doctor could not run: ${read.reason}`];
  }

  const lines = read.report.areas.flatMap((area) =>
    area.problems.map((problem) => problem.line),
  );

  return lines.length === 0 ? ["Doctor reports no problems."] : lines;
}
