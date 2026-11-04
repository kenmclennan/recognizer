export type ScanEvent =
  | {
      event: "phase";
      phase: "extract";
      state: "run" | "current";
      commit: string | null;
    }
  | { event: "phase"; phase: "describe" | "sense"; total: number }
  | {
      event: "entry";
      phase: "extract" | "describe" | "sense";
      name: string;
      outcome: "ok" | "failed";
      reason?: string;
    }
  | { event: "start"; phase: "sense"; name: string }
  | { event: "summary" };

export type PhaseName = "extract" | "describe" | "sense";

export type EntryResult = {
  name: string;
  outcome: "ok" | "failed";
  reason: string | null;
};

export type PhaseProgress = { total: number; entries: EntryResult[] };

export type ScanProgress = {
  extract: "pending" | "run" | "current";
  extractEntries: EntryResult[];
  describe: PhaseProgress | null;
  sense: PhaseProgress | null;
  extractSettled: boolean;
  done: boolean;
  stopped: boolean;
};

export type ShowTarget =
  | { kind: "sensor"; name: string; reason: string }
  | { kind: "module"; id: string; reason: string };

export const NO_PROGRESS: ScanProgress = {
  extract: "pending",
  extractEntries: [],
  describe: null,
  sense: null,
  extractSettled: false,
  done: false,
  stopped: false,
};

const PHASES: readonly string[] = ["extract", "describe", "sense"];

export function parseScanLine(text: string): ScanEvent | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const line = parsed as Record<string, unknown>;

  switch (line.event) {
    case "summary":
      return { event: "summary" };
    case "phase":
      return phaseEvent(line);
    case "entry":
      return entryEvent(line);
    case "start":
      return line.phase === "sense" && typeof line.name === "string"
        ? { event: "start", phase: "sense", name: line.name }
        : null;
    default:
      return null;
  }
}

function phaseEvent(line: Record<string, unknown>): ScanEvent | null {
  if (line.phase === "extract") {
    return line.state === "run" || line.state === "current"
      ? {
          event: "phase",
          phase: "extract",
          state: line.state,
          commit: typeof line.commit === "string" ? line.commit : null,
        }
      : null;
  }

  if (
    (line.phase === "describe" || line.phase === "sense") &&
    typeof line.total === "number"
  ) {
    return { event: "phase", phase: line.phase, total: line.total };
  }

  return null;
}

function entryEvent(line: Record<string, unknown>): ScanEvent | null {
  if (
    typeof line.phase !== "string" ||
    !PHASES.includes(line.phase) ||
    typeof line.name !== "string" ||
    (line.outcome !== "ok" && line.outcome !== "failed")
  ) {
    return null;
  }

  return {
    event: "entry",
    phase: line.phase as PhaseName,
    name: line.name,
    outcome: line.outcome,
    ...(typeof line.reason === "string" ? { reason: line.reason } : {}),
  };
}

export function foldProgress(
  state: ScanProgress,
  event: ScanEvent,
): ScanProgress {
  switch (event.event) {
    case "start":
      return state;
    case "summary":
      return { ...state, extractSettled: true, done: true };
    case "phase":
      if (event.phase === "extract") {
        return { ...state, extract: event.state };
      }

      return {
        ...state,
        extractSettled: true,
        [event.phase]: { total: event.total, entries: [] },
      };
    case "entry": {
      const result: EntryResult = {
        name: event.name,
        outcome: event.outcome,
        reason: event.reason ?? null,
      };

      if (event.phase === "extract") {
        return {
          ...state,
          extractEntries: [...state.extractEntries, result],
        };
      }

      const phase = state[event.phase] ?? { total: 0, entries: [] };

      return {
        ...state,
        [event.phase]: { ...phase, entries: [...phase.entries, result] },
      };
    }
  }
}

export function stoppedProgress(state: ScanProgress): ScanProgress {
  return { ...state, stopped: true };
}

function failures(entries: EntryResult[]): EntryResult[] {
  return entries.filter((entry) => entry.outcome === "failed");
}

const DESCRIBE_PHASE_KEY = "describe";

export type RunRow = { key: string; display: string };

export function scanningText(
  rows: readonly RunRow[],
  started: string | null,
  progress: ScanProgress,
): string | null {
  if (progress.done || progress.stopped) {
    return null;
  }

  if (started === DESCRIBE_PHASE_KEY) {
    const describe = progress.describe;

    return describe === null
      ? "Scanning\u2026"
      : `Describing\u2026 ${describe.entries.length} of ${describe.total} modules`;
  }

  const sensors = rows.filter((row) => row.key !== DESCRIBE_PHASE_KEY);
  const at = sensors.findIndex((row) => row.key === started);
  const row = sensors[at];

  if (row === undefined) {
    return "Scanning\u2026";
  }

  return `Running ${row.display}\u2026 ${at + 1} of ${sensors.length}`;
}

export function showTarget(progress: ScanProgress): ShowTarget | null {
  const module = failures(progress.describe?.entries ?? [])[0];

  if (module !== undefined) {
    return {
      kind: "module",
      id: module.name,
      reason: module.reason ?? "describe failed",
    };
  }

  const sensor = failures(progress.sense?.entries ?? [])[0];

  if (sensor !== undefined) {
    return {
      kind: "sensor",
      name: sensor.name,
      reason: sensor.reason ?? "failed",
    };
  }

  return null;
}
