import { validateRunRecord } from "recognizer";
import { STRUCTURE_KEY } from "./freshness-model";
import { DESCRIBE_KEY, MUTATION_KEY, type PlannedRun } from "./scan-freshness";

export type SenseSample = {
  durationMs: number;
  modules: number;
  fixedMs: number | undefined;
};

export type DescribeSample = { ms: number; entries: number };

export type ScanHistory = {
  structureMs: number | null;
  extractMs: number | null;
  describe: DescribeSample[];
  sense: Record<string, SenseSample[]>;
};

export const NO_HISTORY: ScanHistory = {
  structureMs: null,
  extractMs: null,
  describe: [],
  sense: {},
};

export type PartSpec = { key: string; name: string; runsTests: boolean };

export type EstimatePart = {
  key: string;
  name: string;
  ms: number | null;
  basis: string | null;
};

export type ScanEstimate = { text: string; title: string };

export const NO_ESTIMATE_TEXT =
  "No estimate until this repository has been scanned";

const RECENT = 5;

export function roundedTime(ms: number): string {
  const seconds = ms / 1000;

  if (seconds < 60) {
    return "under a minute";
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `about ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest === 0 ? `about ${hours} h` : `about ${hours} h ${rest} min`;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function shortTime(ms: number): string {
  const seconds = ms / 1000;

  if (seconds < 60) {
    return "<1 min";
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function scanHistory(
  files: readonly { name: string; text: string }[],
): ScanHistory {
  const ordered = [...files].sort((a, b) =>
    a.name < b.name ? 1 : a.name > b.name ? -1 : 0,
  );
  const history: ScanHistory = {
    structureMs: null,
    extractMs: null,
    describe: [],
    sense: {},
  };

  for (const file of ordered) {
    let record: ReturnType<typeof validateRunRecord>;

    try {
      record = validateRunRecord(JSON.parse(file.text));
    } catch {
      continue;
    }

    if (record.kind !== "scan" || record.outcome === "running") {
      continue;
    }

    if (history.structureMs === null && record.structure_ms !== undefined) {
      history.structureMs = record.structure_ms;
    }

    for (const phase of record.phases ?? []) {
      const usable = phase.entries.filter(
        (entry) => entry.outcome === "ok" && entry.incomplete !== true,
      );

      if (phase.phase === "extract") {
        if (history.extractMs === null && usable.length > 0) {
          history.extractMs = usable.reduce(
            (total, entry) => total + entry.duration_ms,
            0,
          );
        }

        continue;
      }

      if (phase.phase === "describe") {
        if (
          history.describe.length < RECENT &&
          phase.duration_ms !== undefined &&
          usable.length > 0
        ) {
          history.describe.push({
            ms: phase.duration_ms,
            entries: usable.length,
          });
        }

        continue;
      }

      if (phase.phase !== "sense") {
        continue;
      }

      for (const entry of usable) {
        if (entry.modules === undefined || entry.modules === 0) {
          continue;
        }

        const samples = history.sense[entry.name] ?? [];

        history.sense[entry.name] = samples;
        samples.push({
          durationMs: entry.duration_ms,
          modules: entry.modules,
          fixedMs: entry.fixed_ms,
        });
      }
    }
  }

  return history;
}

export function describeRateMs(history: ScanHistory): number | null {
  const entries = history.describe.reduce(
    (total, one) => total + one.entries,
    0,
  );

  return entries === 0
    ? null
    : history.describe.reduce((total, one) => total + one.ms, 0) / entries;
}

function secondsText(ms: number): string {
  const seconds = ms / 1000;

  return seconds >= 10
    ? String(Math.round(seconds))
    : String(Math.round(seconds * 10) / 10);
}

function senseFigure(
  samples: SenseSample[],
  spec: PartSpec,
  n: number,
): { ms: number; basis: string } | null {
  const recent = samples
    .filter((one) => !spec.runsTests || one.fixedMs !== undefined)
    .slice(0, RECENT);
  const newest = recent[0];

  if (newest === undefined) {
    return null;
  }

  const fixed = spec.runsTests ? (newest.fixedMs as number) : 0;
  const rate = median(
    recent.map(
      (one) =>
        Math.max(
          0,
          one.durationMs - (spec.runsTests ? (one.fixedMs as number) : 0),
        ) / one.modules,
    ),
  );
  const basis =
    spec.runsTests && spec.key !== MUTATION_KEY
      ? `${plural(n, "module")}, last run's pace`
      : `${plural(n, "module")} at recent pace`;

  return { ms: fixed + n * rate, basis };
}

export function estimateParts(
  history: ScanHistory,
  planned: PlannedRun,
  rows: readonly PartSpec[],
): EstimatePart[] {
  const parts: EstimatePart[] = [];

  for (const spec of rows) {
    const { key, name } = spec;

    if (key === STRUCTURE_KEY) {
      parts.push(
        history.structureMs === null
          ? { key, name, ms: null, basis: null }
          : {
              key,
              name,
              ms: history.structureMs + (history.extractMs ?? 0),
              basis: "last run",
            },
      );

      continue;
    }

    const n = planned.work[key] ?? 0;
    const ticked =
      key === DESCRIBE_KEY
        ? planned.plan.describe
        : planned.plan.sense.includes(key);

    if (!ticked || n === 0) {
      continue;
    }

    if (key === DESCRIBE_KEY) {
      const rate = describeRateMs(history);

      parts.push(
        rate === null
          ? { key, name, ms: null, basis: null }
          : {
              key,
              name,
              ms: rate * n,
              basis: `${plural(n, "module")} × ${secondsText(rate)} s`,
            },
      );

      continue;
    }

    const figure = senseFigure(history.sense[key] ?? [], spec, n);

    parts.push(
      figure === null
        ? { key, name, ms: null, basis: null }
        : { key, name, ms: figure.ms, basis: figure.basis },
    );
  }

  return parts;
}

export function estimateLine(parts: readonly EstimatePart[]): ScanEstimate {
  const known = parts.filter((one) => one.ms !== null);
  const missing = parts.filter((one) => one.ms === null);

  if (known.length === 0) {
    return { text: NO_ESTIMATE_TEXT, title: "" };
  }

  const total = known.reduce((sum, one) => sum + (one.ms as number), 0);
  const text =
    capitalised(roundedTime(total)) +
    (missing.length === 0
      ? ""
      : `, plus ${missing.map((one) => one.name).join(", ")}: no estimate yet`);
  const title = [
    ...known.map(
      (one) => `${one.name}: ${shortTime(one.ms as number)} (${one.basis})`,
    ),
    ...missing.map((one) => `${one.name}: no estimate yet`),
  ].join("\n");

  return { text, title };
}
