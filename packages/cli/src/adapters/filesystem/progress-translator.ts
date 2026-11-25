import type {
  Diagnosis,
  MarkerFacts,
  PluginFailure,
  RunReport,
} from "@recognizer/core";
import type { ScanRunRecord } from "../../scan-marker.js";

const PLUGIN_PHASES = ["sense", "measure"];

type PluginPhase = "extract" | "describe" | "sense";

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

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

function phased(phase: PluginPhase): { phase?: PluginPhase } {
  return phase === "sense" ? {} : { phase };
}

function pluginReport(
  name: string,
  data: unknown,
  phase: PluginPhase,
): RunReport | null | undefined {
  if (!isRecord(data)) {
    return UNREADABLE;
  }

  if (data.event === "start" || data.event === "progress") {
    const done = data.event === "start" ? 0 : data.done;
    const shaped =
      typeof done === "number" ? progressOf(data, done) : UNREADABLE;

    if (shaped === null || shaped.kind !== "plugin-progress") {
      return UNREADABLE;
    }

    if (phase === "extract" && data.event === "start") {
      return {
        kind: "plugin-started",
        name,
        progress: shaped.progress,
        phase,
      };
    }

    return { ...shaped, name, ...phased(phase) };
  }

  if (data.event === "stage") {
    const { name: stageName, index, of } = data;

    return typeof stageName === "string" &&
      stageName !== "" &&
      typeof index === "number" &&
      typeof of === "number"
      ? {
          kind: "plugin-stage",
          name,
          stage: { name: stageName, index, of },
          ...phased(phase),
        }
      : UNREADABLE;
  }

  if (data.event === "estimate") {
    const remaining = data.remaining_ms;

    return remaining === null || typeof remaining === "number"
      ? {
          kind: "plugin-estimate",
          name,
          estimateMs: remaining,
          ...phased(phase),
        }
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

function endOf(
  value: Record<string, unknown>,
): "finished" | "failed" | "stopped" | null {
  return value.outcome === "ok"
    ? "finished"
    : value.outcome === "failed"
      ? "failed"
      : value.outcome === "stopped"
        ? "stopped"
        : null;
}

function extractPhaseReport(value: Record<string, unknown>): RunReport {
  if (value.state === "current") {
    return { kind: "extract-current" };
  }

  if (value.state !== "run") {
    return UNREADABLE;
  }

  if (value.languages === undefined) {
    return { kind: "extract-current" };
  }

  return Array.isArray(value.languages) && value.languages.every(nonEmpty)
    ? { kind: "extract-planned", languages: value.languages }
    : UNREADABLE;
}

function phaseReport(value: Record<string, unknown>): RunReport | null {
  if (value.phase === "extract") {
    return extractPhaseReport(value);
  }

  if (value.phase === "describe") {
    return isCount(value.total)
      ? {
          kind: "plugin-started",
          name: "describe",
          progress: { done: 0, total: value.total, unit: "files" },
          phase: "describe",
        }
      : UNREADABLE;
  }

  return null;
}

function entryReport(
  value: Record<string, unknown>,
  name: string,
  phase: PluginPhase,
): RunReport {
  const state = endOf(value);

  if (state === null) {
    return UNREADABLE;
  }

  if (phase === "describe") {
    return {
      kind: "plugin-item",
      name: "describe",
      item: name,
      ok: state === "finished",
      reason: failureOf(value).reason,
      phase,
    };
  }

  return state === "failed"
    ? {
        kind: "plugin-ended",
        name,
        state,
        failure: failureOf(value),
        ...phased(phase),
      }
    : { kind: "plugin-ended", name, state, ...phased(phase) };
}

function confirmReport(value: Record<string, unknown>): RunReport {
  const { modules, model, input_tokens: inputTokens, cost_usd: cost } = value;

  return value.phase === "describe" &&
    isCount(modules) &&
    typeof model === "string" &&
    isCount(inputTokens) &&
    (cost === null || (typeof cost === "number" && Number.isFinite(cost)))
    ? {
        kind: "confirmation-asked",
        ask: { modules, model, inputTokens, costUsd: cost },
      }
    : UNREADABLE;
}

function stoppedReport(value: Record<string, unknown>): RunReport {
  const { cause, described, not_described: notDescribed } = value;

  return value.phase === "describe" &&
    (cause === "limit" || cause === "failures") &&
    isCount(described) &&
    isCount(notDescribed)
    ? {
        kind: "describe-halted",
        halt: {
          cause,
          reason: typeof value.reason === "string" ? value.reason : "",
          described,
          notDescribed,
          threshold: isCount(value.threshold) ? value.threshold : 0,
        },
      }
    : UNREADABLE;
}

function structureReport(value: Record<string, unknown>): RunReport {
  if (value.state === "run") {
    return { kind: "structure", state: "running", files: null };
  }

  return value.state === "done" || value.state === "failed"
    ? {
        kind: "structure",
        state: value.state,
        files: isCount(value.files) ? value.files : null,
      }
    : UNREADABLE;
}

function runFactReport(
  event: string,
  value: Record<string, unknown>,
): RunReport | null | undefined {
  switch (event) {
    case "phase":
      return phaseReport(value);
    case "confirm":
      return confirmReport(value);
    case "answered":
      return value.phase === "describe" && typeof value.describe === "boolean"
        ? { kind: "confirmation-answered", describe: value.describe }
        : UNREADABLE;
    case "stopped":
      return stoppedReport(value);
    case "structure":
      return structureReport(value);
    case "summary":
      return {
        kind: "logged",
        log: typeof value.log === "string" ? value.log : null,
      };
    default:
      return undefined;
  }
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

  if (typeof event !== "string") {
    return null;
  }

  const fact = runFactReport(event, value);

  if (fact !== undefined) {
    return fact;
  }

  if (typeof phase !== "string" || typeof name !== "string") {
    return null;
  }

  if (phase === "extract" || phase === "describe") {
    if (event === "plugin") {
      const data = value.data;

      return isRecord(data) &&
        (phase === "extract"
          ? ["start", "progress", "stage", "estimate"].includes(
              data.event as string,
            )
          : ["stage", "estimate"].includes(data.event as string))
        ? (pluginReport(
            phase === "describe" ? "describe" : name,
            data,
            phase,
          ) ?? null)
        : null;
    }

    return event === "entry" && name !== ""
      ? entryReport(value, name, phase)
      : null;
  }

  if (!PLUGIN_PHASES.includes(phase) || !sensors.has(name)) {
    return null;
  }

  if (event === "start") {
    return { kind: "plugin-started", name, progress: null };
  }

  if (event === "plugin") {
    return pluginReport(name, value.data, "sense") ?? null;
  }

  if (event === "entry") {
    return entryReport(value, name, "sense");
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
