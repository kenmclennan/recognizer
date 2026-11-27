import {
  compareFindings,
  type Finding,
  type FindingsLevel,
  findingsStanding,
  type SensorFindings,
} from "@recognizer/core";

export type FindingRow = {
  id: string;
  module: string;
  kind: string;
  severity: "violation" | "warning";
  summary: string;
  principle: string;
  sensor: string;
  reported: boolean;
  record: Finding;
};

export type BadgeTone = "none" | "amber" | "red";

export function findingRows(documents: SensorFindings[]): FindingRow[] {
  return documents.flatMap((document) =>
    document.findings.map((record) => ({
      id: record.id,
      module: record.files[0] ?? "",
      kind: record.kind,
      severity: record.severity,
      summary: record.summary,
      principle: record.principle,
      sensor: document.sensor.name,
      reported: document.reportedAt !== undefined,
      record,
    })),
  );
}

export function orderFindings(rows: FindingRow[]): FindingRow[] {
  return [...rows].sort((a, b) => compareFindings(a.record, b.record));
}

export function walkFindings(
  visible: FindingRow[],
  activeId: string | null,
  delta: 1 | -1,
): string | null {
  const sequence = visible.map((row) => row.id);

  if (sequence.length === 0) {
    return activeId;
  }

  const at = activeId === null ? -1 : sequence.indexOf(activeId);

  if (at === -1) {
    return delta === 1 ? (sequence[0] as string) : (sequence.at(-1) as string);
  }

  return sequence[
    Math.min(sequence.length - 1, Math.max(0, at + delta))
  ] as string;
}

const TONES: Record<FindingsLevel, BadgeTone> = {
  none: "none",
  warning: "amber",
  violation: "red",
};

export function badge(rows: FindingRow[]): { count: number; tone: BadgeTone } {
  const standing = findingsStanding(rows);

  return { count: standing.violations, tone: TONES[standing.level] };
}
