import type {
  Diagnosis,
  MarkerFacts,
  PluginFailure,
  RunReport,
} from "@recognizer/core";
import type { ScanRunRecord } from "../../scan-marker.js";

const PLUGIN_PHASES = ["sense", "measure"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function progressOf(
  value: Record<string, unknown>,
  done: number,
): RunReport | null {
  const { total, unit } = value;

  return typeof total === "number" && typeof unit === "string"
    ? {
        kind: "plugin-progress",
        name: "",
        progress: { done, total, unit },
      }
    : null;
}

const UNREADABLE: RunReport = { kind: "unreadable" };

function pluginReport(
  name: string,
  data: unknown,
): RunReport | null | undefined {
  if (!isRecord(data)) {
    return UNREADABLE;
  }

  if (data.event === "start" || data.event === "progress") {
    const done = data.event === "start" ? 0 : data.done;
    const shaped =
      typeof done === "number" ? progressOf(data, done) : UNREADABLE;

    return shaped !== null && shaped.kind === "plugin-progress"
      ? { ...shaped, name }
      : UNREADABLE;
  }

  if (data.event === "stage") {
    const { name: stageName, index, of } = data;

    return typeof stageName === "string" &&
      stageName !== "" &&
      typeof index === "number" &&
      typeof of === "number"
      ? { kind: "plugin-stage", name, stage: { name: stageName, index, of } }
      : UNREADABLE;
  }

  if (data.event === "estimate") {
    const remaining = data.remaining_ms;

    return remaining === null || typeof remaining === "number"
      ? { kind: "plugin-estimate", name, estimateMs: remaining }
      : UNREADABLE;
  }

  return undefined;
}

const NO_REASON = "no reason was recorded";

function failureOf(value: Record<string, unknown>): PluginFailure {
  const { reason, diagnosis } = value;

  return {
    reason: typeof reason === "string" && reason !== "" ? reason : NO_REASON,
    diagnosis: isRecord(diagnosis) ? (diagnosis as unknown as Diagnosis) : null,
  };
}

export function reportOfLine(
  line: string,
  sensors: ReadonlySet<string>,
): RunReport | null {
  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch {
    return UNREADABLE;
  }

  if (!isRecord(value)) {
    return UNREADABLE;
  }

  const { event, phase, name } = value;

  if (
    typeof event !== "string" ||
    typeof phase !== "string" ||
    !PLUGIN_PHASES.includes(phase) ||
    typeof name !== "string" ||
    !sensors.has(name)
  ) {
    return null;
  }

  if (event === "start") {
    return { kind: "plugin-started", name, progress: null };
  }

  if (event === "plugin") {
    return pluginReport(name, value.data) ?? null;
  }

  if (event === "entry") {
    const state =
      value.outcome === "ok"
        ? "finished"
        : value.outcome === "failed"
          ? "failed"
          : value.outcome === "stopped"
            ? "stopped"
            : null;

    if (state === null) {
      return UNREADABLE;
    }

    return state === "failed"
      ? { kind: "plugin-ended", name, state, failure: failureOf(value) }
      : { kind: "plugin-ended", name, state };
  }

  return null;
}

export function markerFactsOf(
  record: ScanRunRecord,
  endedAt: string | null,
): MarkerFacts {
  return {
    runId: record.run_id,
    startedBy: record.started_by,
    startedAt: record.started_at,
    scope: { kind: "working-tree" },
    sensors: [...record.sensors],
    describe: record.describe,
    suites: Object.fromEntries(
      Object.entries(record.suites).map(([key, names]) => [key, [...names]]),
    ),
    phase: record.phase,
    endedAt,
    exit: record.exit,
    gaps: record.gaps.map((gap) => ({ ...gap, needs: [...gap.needs] })),
    failure: record.failure === null ? null : { ...record.failure },
    ran: record.ran === null ? null : [...record.ran],
  };
}
