export type ScanEvent =
  | {
      event: "phase";
      phase: "extract";
      state: "run" | "current";
      commit: string | null;
    }
  | { event: "phase"; phase: "describe" | "measure" | "sense"; total: number }
  | {
      event: "entry";
      phase: "extract" | "describe" | "measure" | "sense";
      name: string;
      outcome: "ok" | "failed";
      reason?: string;
    }
  | { event: "summary" };

export type PhaseName = "extract" | "describe" | "measure" | "sense";

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
  measure: PhaseProgress | null;
  sense: PhaseProgress | null;
  extractSettled: boolean;
  done: boolean;
  stopped: boolean;
};

export type ScanFooter = {
  text: string;
  running: boolean;
  failed: number;
  tone: "muted" | "amber";
};

export type ShowTarget =
  | { kind: "sensor"; name: string; reason: string }
  | { kind: "module"; id: string; reason: string }
  | { kind: "overlay"; name: string; reason: string };

export const NO_PROGRESS: ScanProgress = {
  extract: "pending",
  extractEntries: [],
  describe: null,
  measure: null,
  sense: null,
  extractSettled: false,
  done: false,
  stopped: false,
};

const PHASES: readonly string[] = ["extract", "describe", "measure", "sense"];

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
    (line.phase === "describe" ||
      line.phase === "measure" ||
      line.phase === "sense") &&
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function sameReasonSentence(
  label: string,
  phase: PhaseProgress | null,
): string | null {
  if (phase === null) {
    return null;
  }

  const failed = failures(phase.entries);

  if (failed.length === 0 || failed.length !== phase.total) {
    return null;
  }

  const reasons = new Set(failed.map((entry) => entry.reason));

  if (reasons.size !== 1) {
    return null;
  }

  const [reason] = [...reasons];

  return `${label} failed: ${reason ?? "failed"}`;
}

function ranText(progress: ScanProgress): string[] {
  const parts: string[] = [];

  if (progress.extract === "current") {
    parts.push("scans current");
  } else if (progress.extract === "run") {
    parts.push("extracted");
  }

  const described = progress.describe?.entries.length ?? 0;

  if (progress.describe !== null) {
    parts.push(`described ${described}`);
  }

  const measured = progress.measure?.entries.length ?? 0;

  if (progress.measure !== null) {
    parts.push(`measured ${measured}`);
  }

  const sensed = progress.sense?.entries.length ?? 0;

  if (progress.sense !== null) {
    parts.push(plural(sensed, "sensor"));
  }

  return parts;
}

export function failedCount(progress: ScanProgress): number {
  return (
    failures(progress.extractEntries).length +
    failures(progress.describe?.entries ?? []).length +
    failures(progress.measure?.entries ?? []).length +
    failures(progress.sense?.entries ?? []).length
  );
}

function failureText(progress: ScanProgress): string {
  const total = failedCount(progress);
  const phasesInFailure = [
    failures(progress.extractEntries).length,
    failures(progress.describe?.entries ?? []).length,
    failures(progress.measure?.entries ?? []).length,
    failures(progress.sense?.entries ?? []).length,
  ].filter((count) => count > 0).length;

  if (phasesInFailure === 1) {
    const sentence =
      sameReasonSentence("Describe", progress.describe) ??
      sameReasonSentence("Measure", progress.measure) ??
      sameReasonSentence("Sensors", progress.sense);

    if (sentence !== null) {
      return sentence;
    }
  }

  return `${total} failed`;
}

function runningText(progress: ScanProgress): string {
  if (progress.sense !== null) {
    return `Sensors ${progress.sense.entries.length} of ${progress.sense.total}`;
  }

  if (progress.measure !== null) {
    return `Measuring ${progress.measure.entries.length} of ${progress.measure.total}`;
  }

  if (progress.describe !== null) {
    return `Describing ${progress.describe.entries.length} of ${progress.describe.total}`;
  }

  if (progress.extract === "current") {
    return "Scans current";
  }

  return "Extracting";
}

export function footerText(progress: ScanProgress): ScanFooter {
  const failed = failedCount(progress);

  if (progress.stopped) {
    const parts = ranText(progress);

    return {
      text: parts.length === 0 ? "Stopped" : `Stopped - ${parts.join(", ")}`,
      running: false,
      failed,
      tone: "amber",
    };
  }

  if (!progress.done) {
    return {
      text: runningText(progress),
      running: true,
      failed: 0,
      tone: "muted",
    };
  }

  if (failed > 0) {
    return {
      text: failureText(progress),
      running: false,
      failed,
      tone: "amber",
    };
  }

  const parts = ranText(progress);

  return {
    text: parts.length === 0 ? "Scan done" : `Scan done - ${parts.join(", ")}`,
    running: false,
    failed: 0,
    tone: "muted",
  };
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

  const overlay = failures(progress.measure?.entries ?? [])[0];

  if (overlay !== undefined) {
    return {
      kind: "overlay",
      name: overlay.name,
      reason: overlay.reason ?? "failed",
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
