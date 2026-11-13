import { validateRunRecord } from "recognizer";

export type DescribeSample = { ms: number; entries: number };

export type ScanHistory = {
  structureMs: number | null;
  extractMs: number | null;
  describe: DescribeSample[];
};

export const NO_HISTORY: ScanHistory = {
  structureMs: null,
  extractMs: null,
  describe: [],
};

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
