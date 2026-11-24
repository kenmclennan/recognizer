import type { MarkerFacts, RunReport } from "@recognizer/core";
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

  return undefined;
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

    return state === null ? UNREADABLE : { kind: "plugin-ended", name, state };
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
  };
}
