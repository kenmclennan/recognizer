import type { FindingRecord, FindingsDocument } from "recognizer";
import type { SensorRow } from "./sensors-panel-model";

export type FindingRow = {
  id: string;
  module: string;
  kind: string;
  severity: "violation" | "warning";
  summary: string;
  principle: string;
  sensor: string;
  record: FindingRecord;
};

export type FindingFilter =
  | { by: "all" }
  | { by: "severity"; severity: "violation" | "warning" }
  | { by: "sensor"; name: string };

export type BadgeTone = "none" | "amber" | "red";

export type FindingGroup = {
  severity: "violation" | "warning";
  kinds: { kind: string; rows: FindingRow[] }[];
};

export type FindingChip = {
  label: string;
  count: number;
  filter: FindingFilter;
};

const SEVERITIES: ("violation" | "warning")[] = ["violation", "warning"];

export function kindLabel(kind: string): string {
  const words = kind.replace(/[-_]+/g, " ").trim();

  return words === "" ? kind : words[0]?.toUpperCase() + words.slice(1);
}

export function severityLabel(severity: "violation" | "warning"): string {
  return severity === "violation" ? "Violations" : "Warnings";
}

export function groupCount(group: FindingGroup): number {
  return group.kinds.reduce((sum, kind) => sum + kind.rows.length, 0);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function findingRows(documents: FindingsDocument[]): FindingRow[] {
  return documents.flatMap((document) =>
    document.findings.map((record) => ({
      id: record.id,
      module: record.evidence.modules[0] as string,
      kind: record.kind,
      severity: record.severity,
      summary: record.summary,
      principle: record.principle,
      sensor: document.sensor.name,
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

export function groupFindings(rows: FindingRow[]): FindingGroup[] {
  const ordered = orderFindings(rows);
  const groups: FindingGroup[] = [];

  for (const severity of SEVERITIES) {
    const kinds: FindingGroup["kinds"] = [];

    for (const row of ordered) {
      if (row.severity !== severity) {
        continue;
      }

      const last = kinds.at(-1);

      if (last !== undefined && last.kind === row.kind) {
        last.rows.push(row);
      } else {
        kinds.push({ kind: row.kind, rows: [row] });
      }
    }

    if (kinds.length > 0) {
      groups.push({ severity, kinds });
    }
  }

  return groups;
}

export function applyFilter(
  rows: FindingRow[],
  filter: FindingFilter,
): FindingRow[] {
  if (filter.by === "severity") {
    return rows.filter((row) => row.severity === filter.severity);
  }

  if (filter.by === "sensor") {
    const named = rows.filter((row) => row.sensor === filter.name);

    return named.length === 0 ? rows : named;
  }

  return rows;
}

export function chips(rows: FindingRow[]): FindingChip[] {
  const violations = rows.filter((row) => row.severity === "violation").length;
  const warnings = rows.length - violations;
  const result: FindingChip[] = [
    { label: "all", count: rows.length, filter: { by: "all" } },
  ];

  if (violations > 0) {
    result.push({
      label: "violations",
      count: violations,
      filter: { by: "severity", severity: "violation" },
    });
  }

  if (warnings > 0) {
    result.push({
      label: "warnings",
      count: warnings,
      filter: { by: "severity", severity: "warning" },
    });
  }

  for (const name of [...new Set(rows.map((row) => row.sensor))].sort(
    compare,
  )) {
    result.push({
      label: name,
      count: rows.filter((row) => row.sensor === name).length,
      filter: { by: "sensor", name },
    });
  }

  return result;
}

export function sameFilter(a: FindingFilter, b: FindingFilter): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function walkFindings(
  visible: FindingRow[],
  activeId: string | null,
  delta: 1 | -1,
): string | null {
  const sequence = orderFindings(visible).map((row) => row.id);

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

export function staleNote(sensors: SensorRow[]): string | null {
  const named = sensors
    .filter(
      (row) =>
        row.kind === "registered" &&
        (row.chip === "stale" ||
          row.chip === "failed" ||
          row.chip === "not run"),
    )
    .map((row) => `${row.name} (${row.chip})`);

  return named.length === 0 ? null : `Not current: ${named.join(", ")}`;
}
