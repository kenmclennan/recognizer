import { type Diagnosis, type Gap, isGap } from "recognizer";

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
      diagnosis?: Diagnosis;
    }
  | { event: "start"; phase: "sense"; name: string }
  | ({ event: "progress"; phase: "sense"; name: string } & SensorStep)
  | ({ event: "stopped"; phase: "describe" } & DescribeStop)
  | ({ event: "confirm"; phase: "describe" } & DescribeAsk)
  | { event: "preflight"; state: "run" | "ok" }
  | { event: "preflight"; state: "gaps"; gaps: Gap[] }
  | { event: "summary"; exit?: number };

export type DescribeAsk = {
  modules: number;
  model: string;
  inputTokens: number;
  costUsd: number | null;
};

export type DescribeStop = {
  cause: "limit" | "failures";
  reason: string;
  described: number;
  notDescribed: number;
  threshold: number;
};

export type SensorStep =
  | { step: "coverage" }
  | { step: "mutants"; done: number; total: number };

export type SensorProgress = { name: string } & SensorStep;

export type PhaseName = "extract" | "describe" | "sense";

export type EntryResult = {
  name: string;
  outcome: "ok" | "failed";
  reason: string | null;
  diagnosis: Diagnosis | null;
};

export type PhaseProgress = { total: number; entries: EntryResult[] };

export type ScanProgress = {
  extract: "pending" | "run" | "current";
  extractEntries: EntryResult[];
  describe: PhaseProgress | null;
  describeStop: DescribeStop | null;
  describeAsk: DescribeAsk | null;
  describeSkipped: boolean;
  sense: PhaseProgress | null;
  sensorProgress: SensorProgress | null;
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
  describeStop: null,
  describeAsk: null,
  describeSkipped: false,
  sense: null,
  sensorProgress: null,
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
      return typeof line.exit === "number"
        ? { event: "summary", exit: line.exit }
        : { event: "summary" };
    case "preflight":
      return preflightEvent(line);
    case "phase":
      return phaseEvent(line);
    case "stopped":
      return stoppedEvent(line);
    case "confirm":
      return confirmEvent(line);
    case "entry":
      return entryEvent(line);
    case "start":
      return line.phase === "sense" && typeof line.name === "string"
        ? { event: "start", phase: "sense", name: line.name }
        : null;
    case "progress":
      return progressEvent(line);
    default:
      return null;
  }
}

function preflightEvent(line: Record<string, unknown>): ScanEvent | null {
  if (line.state === "run") {
    return { event: "preflight", state: "run" };
  }

  if (line.state === "ok") {
    return { event: "preflight", state: "ok" };
  }

  if (line.state === "gaps" && Array.isArray(line.gaps)) {
    return {
      event: "preflight",
      state: "gaps",
      gaps: line.gaps.filter(isGap),
    };
  }

  return null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function stoppedEvent(line: Record<string, unknown>): ScanEvent | null {
  if (
    line.phase !== "describe" ||
    (line.cause !== "limit" && line.cause !== "failures") ||
    !isCount(line.described) ||
    !isCount(line.not_described)
  ) {
    return null;
  }

  return {
    event: "stopped",
    phase: "describe",
    cause: line.cause,
    reason: typeof line.reason === "string" ? line.reason : "",
    described: line.described,
    notDescribed: line.not_described,
    threshold: isCount(line.threshold) ? line.threshold : 0,
  };
}

function confirmEvent(line: Record<string, unknown>): ScanEvent | null {
  if (
    line.phase !== "describe" ||
    !isCount(line.modules) ||
    typeof line.model !== "string" ||
    !isCount(line.input_tokens) ||
    (line.cost_usd !== null &&
      (typeof line.cost_usd !== "number" || !Number.isFinite(line.cost_usd)))
  ) {
    return null;
  }

  return {
    event: "confirm",
    phase: "describe",
    modules: line.modules,
    model: line.model,
    inputTokens: line.input_tokens,
    costUsd: line.cost_usd,
  };
}

function progressEvent(line: Record<string, unknown>): ScanEvent | null {
  if (line.phase !== "sense" || typeof line.name !== "string") {
    return null;
  }

  const base = { event: "progress", phase: "sense", name: line.name } as const;

  if (line.step === "coverage") {
    return { ...base, step: "coverage" };
  }

  if (
    line.step === "mutants" &&
    isCount(line.done) &&
    isCount(line.total) &&
    line.done <= line.total
  ) {
    return { ...base, step: "mutants", done: line.done, total: line.total };
  }

  return null;
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

  const diagnosis = diagnosisOf(line.diagnosis);

  return {
    event: "entry",
    phase: line.phase as PhaseName,
    name: line.name,
    outcome: line.outcome,
    ...(typeof line.reason === "string" ? { reason: line.reason } : {}),
    ...(diagnosis === null ? {} : { diagnosis }),
  };
}

const DIAGNOSIS_CODES: readonly string[] = [
  "tool-missing",
  "tests-failed",
  "coverage-unavailable",
];

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function failingOf(value: unknown): Diagnosis["failing"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const { count, names } = value as Record<string, unknown>;

  if (!Array.isArray(names) || !names.every(nonEmpty)) {
    return null;
  }

  return {
    names,
    ...(typeof count === "number" && Number.isInteger(count) && count >= 1
      ? { count }
      : {}),
  };
}

export function diagnosisOf(value: unknown): Diagnosis | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const { code, line, fix, failing } = value as Record<string, unknown>;

  if (
    typeof code !== "string" ||
    !DIAGNOSIS_CODES.includes(code) ||
    !nonEmpty(line) ||
    (fix !== undefined && !nonEmpty(fix))
  ) {
    return null;
  }

  const names = failing === undefined ? undefined : failingOf(failing);

  if (names === null) {
    return null;
  }

  return {
    code: code as Diagnosis["code"],
    line,
    ...(fix === undefined ? {} : { fix }),
    ...(names === undefined ? {} : { failing: names }),
  };
}

export function foldProgress(
  state: ScanProgress,
  event: ScanEvent,
): ScanProgress {
  switch (event.event) {
    case "start":
      return state.sensorProgress === null
        ? state
        : { ...state, sensorProgress: null };
    case "progress": {
      const { event: _event, phase: _phase, ...sensorProgress } = event;

      return { ...state, sensorProgress };
    }
    case "preflight":
      return state;
    case "summary":
      return { ...state, extractSettled: true, done: true };
    case "stopped": {
      const { event: _event, phase: _phase, ...describeStop } = event;

      return { ...state, describeStop };
    }
    case "confirm": {
      const { event: _event, phase: _phase, ...describeAsk } = event;

      return { ...state, describeAsk };
    }
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
        diagnosis: event.diagnosis ?? null,
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
        ...(event.phase === "sense" ? { sensorProgress: null } : {}),
        [event.phase]: { ...phase, entries: [...phase.entries, result] },
      };
    }
  }
}

export function stoppedProgress(state: ScanProgress): ScanProgress {
  return { ...state, stopped: true, describeAsk: null };
}

export function answeredProgress(
  state: ScanProgress,
  describe: boolean,
): ScanProgress {
  return { ...state, describeAsk: null, describeSkipped: !describe };
}

export function tokensText(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens);
  }

  if (tokens < 1_000_000) {
    return `${Math.round(tokens / 1000)}K`;
  }

  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export type DescribeAskText = {
  heading: string;
  model: string;
  estimate: string;
};

export function describeAskText(ask: DescribeAsk): DescribeAskText {
  const tokens = `About ${tokensText(ask.inputTokens)} tokens`;

  return {
    heading: `Describe ${count(ask.modules)} modules?`,
    model: `Model: ${ask.model}`,
    estimate:
      ask.costUsd === null
        ? `${tokens}, price unknown`
        : `${tokens}, $${ask.costUsd.toFixed(2)} at API prices`,
  };
}

function failures(entries: EntryResult[]): EntryResult[] {
  return entries.filter((entry) => entry.outcome === "failed");
}

const DESCRIBE_PHASE_KEY = "describe";

function count(value: number): string {
  return value.toLocaleString("en-US");
}

export function describeStopText(stop: DescribeStop): string {
  const counts = `${count(stop.described)} described, ${count(stop.notDescribed)} not described. The next scan describes the rest.`;

  if (stop.cause === "failures") {
    const last = stop.reason === "" ? "" : ` (last: ${stop.reason})`;

    return `Stopped: ${stop.threshold} describing calls failed in a row${last}. ${counts}`;
  }

  const reason = stop.reason === "" ? "" : `: ${stop.reason}`;

  return `Stopped: Claude usage limit reached${reason}. ${counts}`;
}

export type RunRow = { key: string; display: string };

export function scanningText(
  rows: readonly RunRow[],
  started: string | null,
  progress: ScanProgress,
): string | null {
  if (progress.done || progress.stopped) {
    return null;
  }

  if (progress.describeAsk !== null) {
    return "Waiting for your answer";
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

  const reported = progress.sensorProgress;

  if (reported !== null && reported.name === started) {
    return reported.step === "coverage"
      ? `${row.display}: measuring coverage`
      : `${row.display}: ${reported.done} of ${reported.total} functions`;
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
