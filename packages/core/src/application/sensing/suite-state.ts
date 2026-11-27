import type { SuiteResult } from "../../domain/sensor-findings.js";

export type SuiteStanding = {
  name: string;
  kind: "ok" | "failed" | "partial" | "never";
  at: number | null;
  measured: number;
  total: number;
  reason: string | null;
};

export type SuiteRunning = {
  suite: string;
  done: number | null;
  total: number | null;
  stage?: string;
};

export type SuiteState = {
  kind: SuiteStanding["kind"] | "running";
  text: string;
  title: string;
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function shortAge(ms: number): string {
  const elapsed = Math.max(0, ms);

  if (elapsed < MINUTE) {
    return "now";
  }

  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)}m`;
  }

  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)}h`;
  }

  return `${Math.floor(elapsed / DAY)}d`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function ageText(scannedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - scannedAt) / 60000);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${plural(minutes, "minute")} ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${plural(hours, "hour")} ago`;
  }

  return `${plural(Math.floor(hours / 24), "day")} ago`;
}

export function suiteStanding(result: SuiteResult): SuiteStanding {
  const parsed = result.ranAt === null ? Number.NaN : Date.parse(result.ranAt);

  return {
    name: result.name,
    kind: result.status,
    at: Number.isNaN(parsed) ? null : parsed,
    measured: result.measured ?? 0,
    total: result.total ?? 0,
    reason: result.reason ?? null,
  };
}

export function suiteStandings(
  results: readonly SuiteResult[] | undefined,
): SuiteStanding[] | null {
  return results === undefined ? null : results.map(suiteStanding);
}

export function suiteState(
  standing: SuiteStanding | undefined,
  now: number,
  running: SuiteRunning | null = null,
): SuiteState {
  if (running !== null) {
    const counted = running.done !== null && running.total !== null;

    return {
      kind: "running",
      text: counted ? `${running.done}/${running.total}` : "running",
      title: counted
        ? `${running.done} of ${running.total} functions`
        : "running",
    };
  }

  if (standing === undefined || standing.kind === "never") {
    return { kind: "never", text: "never", title: "never run" };
  }

  const short = standing.at === null ? "" : shortAge(now - standing.at);
  const age = standing.at === null ? "" : ageText(standing.at, now);

  switch (standing.kind) {
    case "ok":
      return { kind: "ok", text: short, title: `current, ${age}` };
    case "failed":
      return {
        kind: "failed",
        text: short,
        title:
          standing.reason === null
            ? `failed ${age}`
            : `failed ${age}: ${standing.reason}`,
      };
    case "partial":
      return {
        kind: "partial",
        text: `${standing.measured}/${standing.total}`,
        title: `${standing.measured} of ${standing.total} functions, ${age}`,
      };
  }
}
