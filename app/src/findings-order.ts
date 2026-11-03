import type { FindingRecord, FindingsDocument } from "recognizer";
import type { ReportRow, SensorRow } from "./scan-panel-model";

export type FindingRow = {
  id: string;
  module: string;
  kind: string;
  severity: "violation" | "warning";
  summary: string;
  principle: string;
  sensor: string;
  reported: boolean;
  record: FindingRecord;
};

export type BadgeTone = "none" | "amber" | "red";

const SEVERITIES: ("violation" | "warning")[] = ["violation", "warning"];

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function findingRows(documents: FindingsDocument[]): FindingRow[] {
  return documents.flatMap((document) =>
    document.findings.map((record) => ({
      id: record.id,
      module: record.evidence.modules[0] ?? "",
      kind: record.kind,
      severity: record.severity,
      summary: record.summary,
      principle: record.principle,
      sensor: document.sensor.name,
      reported: document.reported_at !== undefined,
      record,
    })),
  );
}

export function orderFindings(rows: FindingRow[]): FindingRow[] {
  return [...rows].sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      compare(a.kind, b.kind) ||
      compare(a.module, b.module) ||
      compare(a.id, b.id),
  );
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

export function badge(rows: FindingRow[]): { count: number; tone: BadgeTone } {
  return {
    count: rows.length,
    tone:
      rows.length === 0
        ? "none"
        : rows.some((row) => row.severity === "violation")
          ? "red"
          : "amber",
  };
}

export function staleNote(
  sensors: SensorRow[],
  reports: ReportRow[] = [],
): string | null {
  const named = sensors
    .filter(
      (row) =>
        row.kind === "registered" &&
        (row.chip === "stale" ||
          row.chip === "failed" ||
          row.chip === "not run"),
    )
    .map((row) => `${row.name} (${row.chip})`);

  named.push(
    ...reports
      .filter((row) => row.stale)
      .map((row) => `${row.name} (reported at ${row.commit})`),
  );

  return named.length === 0 ? null : `Not current: ${named.join(", ")}`;
}
