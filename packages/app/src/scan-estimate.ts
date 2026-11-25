import { validateRunRecord } from "recognizer";
import { ANALYSIS_KEY } from "./freshness-model";
import { DESCRIBE_KEY, type PlannedRun } from "./scan-freshness";
import { median } from "./suite-pace";

export type SenseSample = {
  durationMs: number;
  modules: number;
  fixedMs: number | undefined;
  work?: { unit: string; performed: number } | undefined;
  suites?: { name: string; durationMs: number }[] | undefined;
};

export type PlannedWork = { unit: string; to_perform: number };

export type DescribeSample = { ms: number; entries: number };

export type ScanHistory = {
  structureMs: number | null;
  extractMs: number | null;
  describe: DescribeSample[];
  sense: Record<string, SenseSample[]>;
  lastRun?: string | null;
};

export const NO_HISTORY: ScanHistory = {
  structureMs: null,
  extractMs: null,
  describe: [],
  sense: {},
};

export type PartSpec = {
  key: string;
  name: string;
  runsTests: boolean;
  scoped: boolean;
  workVerb: string | null;
};

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
    lastRun: null,
  };

  for (const file of ordered) {
    let record: ReturnType<typeof validateRunRecord>;

    try {
      record = validateRunRecord(JSON.parse(file.text));
    } catch {
      continue;
    }

    if (
      record.kind !== "scan" ||
      record.outcome === "running" ||
      record.outcome === "stopped"
    ) {
      continue;
    }

    history.lastRun ??= file.name;

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
          ...(entry.work === undefined ? {} : { work: entry.work }),
          ...(entry.suites === undefined
            ? {}
            : {
                suites: entry.suites.map((one) => ({
                  name: one.name,
                  durationMs: one.duration_ms,
                })),
              }),
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

const NOTHING_TO_MEASURE =
  "nothing to measure; the baseline and coverage runs only";

function workFigure(
  samples: SenseSample[],
  work: PlannedWork | null,
): { ms: number; basis: string } | null {
  const fixedFrom = samples.find((one) => one.fixedMs !== undefined);

  if (work === null || fixedFrom === undefined) {
    return null;
  }

  const fixed = fixedFrom.fixedMs as number;

  if (work.to_perform === 0) {
    return { ms: fixed, basis: NOTHING_TO_MEASURE };
  }

  const rates = samples
    .filter(
      (one) =>
        one.fixedMs !== undefined &&
        one.work !== undefined &&
        one.work.unit === work.unit &&
        one.work.performed > 0,
    )
    .slice(0, RECENT)
    .map(
      (one) =>
        Math.max(0, one.durationMs - (one.fixedMs as number)) /
        (one.work as { performed: number }).performed,
    );

  if (rates.length === 0) {
    return null;
  }

  return {
    ms: fixed + work.to_perform * median(rates),
    basis: `${plural(work.to_perform, "function")} at recent pace`,
  };
}

function senseFigure(
  samples: SenseSample[],
  spec: PartSpec,
  n: number,
  work: PlannedWork | null,
): { ms: number; basis: string } | null {
  if (spec.workVerb !== null || work !== null) {
    return workFigure(samples, work);
  }

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
    spec.runsTests && !spec.scoped
      ? `${plural(n, "file")}, last run's pace`
      : `${plural(n, "file")} at recent pace`;

  return { ms: fixed + n * rate, basis };
}

export function estimateParts(
  history: ScanHistory,
  planned: PlannedRun,
  rows: readonly PartSpec[],
  work: Readonly<Record<string, PlannedWork>> = {},
): EstimatePart[] {
  const parts: EstimatePart[] = [];

  for (const spec of rows) {
    const { key, name } = spec;

    if (key === ANALYSIS_KEY) {
      if (!planned.plan.analysis) {
        continue;
      }

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
              basis: `${plural(n, "file")} × ${secondsText(rate)} s`,
            },
      );

      continue;
    }

    const figure = senseFigure(
      history.sense[key] ?? [],
      spec,
      n,
      work[key] ?? null,
    );

    const plannedWork = work[key] ?? null;

    if (figure !== null) {
      parts.push({ key, name, ms: figure.ms, basis: figure.basis });
    } else if (
      spec.workVerb !== null &&
      plannedWork !== null &&
      plannedWork.to_perform > 0
    ) {
      parts.push({
        key,
        name,
        ms: null,
        basis: `${plural(plannedWork.to_perform, "function")} to ${spec.workVerb}, no pace yet`,
      });
    } else {
      parts.push({ key, name, ms: null, basis: null });
    }
  }

  return parts;
}

function missingText(part: EstimatePart): string {
  return `${part.name}: ${part.basis ?? "no estimate yet"}`;
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
      : `, plus ${missing.map(missingText).join(", ")}`);
  const title = [
    ...known.map(
      (one) => `${one.name}: ${shortTime(one.ms as number)} (${one.basis})`,
    ),
    ...missing.map(missingText),
  ].join("\n");

  return { text, title };
}
