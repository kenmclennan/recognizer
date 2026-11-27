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
  kind: SuiteStanding["kind"] | "running" | "stale";
  text: string;
  title: string;
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type AgeStyle = "long" | "short";

const AGE_WORDS = {
  long: {
    now: "just now",
    text: (count: number, unit: string) =>
      `${count} ${unit}${count === 1 ? "" : "s"} ago`,
    minute: "minute",
    hour: "hour",
    day: "day",
  },
  short: {
    now: "now",
    text: (count: number, unit: string) => `${count}${unit}`,
    minute: "m",
    hour: "h",
    day: "d",
  },
} as const;

export function ageText(
  scannedAt: number,
  now: number,
  style: AgeStyle = "long",
): string {
  const words = AGE_WORDS[style];
  const elapsed = Math.max(0, now - scannedAt);

  if (elapsed < MINUTE) {
    return words.now;
  }

  if (elapsed < HOUR) {
    return words.text(Math.floor(elapsed / MINUTE), words.minute);
  }

  if (elapsed < DAY) {
    return words.text(Math.floor(elapsed / HOUR), words.hour);
  }

  return words.text(Math.floor(elapsed / DAY), words.day);
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
  behind = 0,
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

  const short = standing.at === null ? "" : ageText(standing.at, now, "short");
  const age = standing.at === null ? "" : ageText(standing.at, now);

  switch (standing.kind) {
    case "ok":
      if (behind > 0) {
        return {
          kind: "stale",
          text: `${behind} out of date`,
          title: `${behind} ${behind === 1 ? "file" : "files"} out of date, ran ${age}`,
        };
      }

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
