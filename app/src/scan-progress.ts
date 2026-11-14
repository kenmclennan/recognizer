import { type Diagnosis, type Gap, isGap, type PluginEvent } from "recognizer";
import { roundedTime } from "./scan-estimate";

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
      outcome: "ok" | "failed" | "stopped";
      reason?: string;
      diagnosis?: Diagnosis;
    }
  | { event: "start"; phase: "sense"; name: string }
  | { event: "plugin"; phase: PhaseName; name: string; data: PluginEvent }
  | ({ event: "stopped"; phase: "describe" } & DescribeStop)
  | ({ event: "confirm"; phase: "describe" } & DescribeAsk)
  | { event: "answered"; phase: "describe"; describe: boolean }
  | { event: "preflight"; state: "run" | "ok" }
  | { event: "preflight"; state: "gaps"; gaps: Gap[] }
  | { event: "summary"; exit?: number; log?: string | null };

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

export type PluginCount = {
  done: number;
  total: number;
  unit: string;
  step?: string;
};

export type PluginProgress = {
  name: string;
  phase: PhaseName;
  progress?: PluginCount;
  note?: string;
};

export type PhaseName = "extract" | "describe" | "sense";

export type EntryResult = {
  name: string;
  outcome: "ok" | "failed" | "stopped";
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
  sensorProgress: PluginProgress | null;
  startedSuites: Record<string, string[]>;
  extractSettled: boolean;
  done: boolean;
  stopped: boolean;
  sensing: string | null;
  log: string | null;
  timing: ScanTiming;
};

export type ScanTiming = {
  phaseAt: Record<string, number>;
  sensorAt: Record<string, number>;
  describeFrom: number | null;
  rateFrom: { at: number; done: number; unit: string; step?: string } | null;
  frozen: Record<string, number> | null;
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
  startedSuites: {},
  extractSettled: false,
  done: false,
  stopped: false,
  sensing: null,
  log: null,
  timing: {
    phaseAt: {},
    sensorAt: {},
    describeFrom: null,
    rateFrom: null,
    frozen: null,
  },
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
      return {
        event: "summary",
        ...(typeof line.exit === "number" ? { exit: line.exit } : {}),
        ...(typeof line.log === "string" || line.log === null
          ? { log: line.log }
          : {}),
      };
    case "preflight":
      return preflightEvent(line);
    case "phase":
      return phaseEvent(line);
    case "stopped":
      return stoppedEvent(line);
    case "confirm":
      return confirmEvent(line);
    case "answered":
      return line.phase === "describe" && typeof line.describe === "boolean"
        ? { event: "answered", phase: "describe", describe: line.describe }
        : null;
    case "entry":
      return entryEvent(line);
    case "start":
      return line.phase === "sense" && typeof line.name === "string"
        ? { event: "start", phase: "sense", name: line.name }
        : null;
    case "plugin":
      return pluginEvent(line);
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

function pluginEvent(line: Record<string, unknown>): ScanEvent | null {
  if (
    typeof line.phase !== "string" ||
    !PHASES.includes(line.phase) ||
    !nonEmpty(line.name) ||
    typeof line.data !== "object" ||
    line.data === null
  ) {
    return null;
  }

  const data = pluginData(line.data as Record<string, unknown>);

  return data === null
    ? null
    : {
        event: "plugin",
        phase: line.phase as PhaseName,
        name: line.name,
        data,
      };
}

function pluginData(data: Record<string, unknown>): PluginEvent | null {
  switch (data.event) {
    case "start":
      return isCount(data.total) && nonEmpty(data.unit)
        ? { event: "start", total: data.total, unit: data.unit }
        : null;
    case "progress":
      return isCount(data.done) &&
        isCount(data.total) &&
        data.done <= data.total &&
        nonEmpty(data.unit) &&
        (data.step === undefined || nonEmpty(data.step))
        ? {
            event: "progress",
            done: data.done,
            total: data.total,
            unit: data.unit,
            ...(data.step === undefined ? {} : { step: data.step }),
          }
        : null;
    case "note":
      return nonEmpty(data.text) ? { event: "note", text: data.text } : null;
    case "diagnosis":
      return nonEmpty(data.code) &&
        nonEmpty(data.text) &&
        (data.fix === undefined || nonEmpty(data.fix))
        ? {
            event: "diagnosis",
            code: data.code,
            text: data.text,
            ...(data.fix === undefined ? {} : { fix: data.fix }),
          }
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
    (line.outcome !== "ok" &&
      line.outcome !== "failed" &&
      line.outcome !== "stopped")
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

  const { code, line, fix, failing, unmeasured } = value as Record<
    string,
    unknown
  >;

  if (
    !nonEmpty(code) ||
    !nonEmpty(line) ||
    (fix !== undefined && !nonEmpty(fix)) ||
    (unmeasured !== undefined && typeof unmeasured !== "boolean")
  ) {
    return null;
  }

  const names = failing === undefined ? undefined : failingOf(failing);

  if (names === null) {
    return null;
  }

  return {
    code,
    line,
    ...(fix === undefined ? {} : { fix }),
    ...(unmeasured === undefined ? {} : { unmeasured }),
    ...(names === undefined ? {} : { failing: names }),
  };
}

function foldPlugin(
  state: ScanProgress,
  event: Extract<ScanEvent, { event: "plugin" }>,
): ScanProgress {
  const { name, phase, data } = event;
  const stored = state.sensorProgress;

  if (data.event === "start") {
    return { ...state, sensorProgress: { name, phase } };
  }

  if (stored !== null && stored.name !== name) {
    return state;
  }

  if (data.event === "progress") {
    const { event: _event, ...progress } = data;
    const step = progress.step;
    const seen = state.startedSuites[name] ?? [];

    return {
      ...state,
      sensorProgress: { name, phase, progress },
      startedSuites:
        step === undefined || seen.includes(step)
          ? state.startedSuites
          : { ...state.startedSuites, [name]: [...seen, step] },
    };
  }

  if (data.event === "note") {
    return {
      ...state,
      sensorProgress: {
        name,
        phase,
        ...(stored?.progress === undefined
          ? {}
          : { progress: stored.progress }),
        note: data.text,
      },
    };
  }

  return state;
}

function settledExtract(extract: ScanProgress["extract"]) {
  return extract === "run" ? "current" : extract;
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
    case "plugin":
      return foldPlugin(state, event);
    case "preflight":
      return state;
    case "summary":
      return {
        ...state,
        extract: settledExtract(state.extract),
        extractSettled: true,
        done: true,
        log: event.log ?? state.log,
      };
    case "stopped": {
      const { event: _event, phase: _phase, ...describeStop } = event;

      return { ...state, describeStop };
    }
    case "confirm": {
      const { event: _event, phase: _phase, ...describeAsk } = event;

      return { ...state, describeAsk };
    }
    case "answered":
      return { ...state, describeAsk: null, describeSkipped: !event.describe };
    case "phase":
      if (event.phase === "extract") {
        return { ...state, extract: event.state };
      }

      return {
        ...state,
        extract: settledExtract(state.extract),
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
        sensorProgress: null,
        [event.phase]: { ...phase, entries: [...phase.entries, result] },
      };
    }
  }
}

export function stoppedProgress(state: ScanProgress): ScanProgress {
  return { ...state, stopped: true, describeAsk: null };
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

export function describeAskText(
  ask: DescribeAsk,
  rateMs: number | null = null,
): DescribeAskText {
  const tokens = `About ${tokensText(ask.inputTokens)} tokens`;

  return {
    heading: `Describe ${count(ask.modules)} modules?`,
    model: `Model: ${ask.model}`,
    estimate:
      (ask.costUsd === null
        ? `${tokens}, price unknown`
        : `${tokens}, $${ask.costUsd.toFixed(2)} at API prices`) +
      (rateMs === null ? "" : `, ${roundedTime(ask.modules * rateMs)}`),
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
  const reported = progress.sensorProgress;

  if (row === undefined) {
    const extracting =
      reported !== null && reported.phase === "extract"
        ? pluginText(capitalised(reported.name), reported)
        : null;

    return extracting ?? "Scanning\u2026";
  }

  if (reported !== null && reported.name === started) {
    const text = pluginText(row.display, reported);

    if (text !== null) {
      return text;
    }
  }

  return `Running ${row.display}\u2026 ${at + 1} of ${sensors.length}`;
}

function pluginText(display: string, reported: PluginProgress): string | null {
  const counted = reported.progress;

  if (counted !== undefined) {
    const step = counted.step === undefined ? "" : `${counted.step} \u00b7 `;

    return `${display}: ${step}${counted.done} of ${counted.total} ${counted.unit}`;
  }

  return reported.note === undefined ? null : `${display}: ${reported.note}`;
}

function capitalised(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
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
