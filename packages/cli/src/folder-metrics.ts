import type { FolderMetrics } from "@recognizer/core";

export type { FolderMetrics };

function figure(value: number | null): string {
  return value === null ? "unknown" : value.toFixed(2);
}

export function metricsLine(row: FolderMetrics): string {
  return [
    `I ${figure(row.instability)}`,
    `A ${figure(row.abstractness)}`,
    `D ${figure(row.distance)}`,
  ].join(" \u00b7 ");
}

export function metricsTable(row: FolderMetrics): [string, string][] {
  return [
    ["Files", String(row.modules)],
    ["Afferent coupling (Ca)", String(row.afferent)],
    ["Efferent coupling (Ce)", String(row.efferent)],
    ["Instability (I)", figure(row.instability)],
    ["Abstractness (A)", figure(row.abstractness)],
    ["Distance (D)", figure(row.distance)],
  ];
}
