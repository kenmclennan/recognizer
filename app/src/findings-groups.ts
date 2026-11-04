import { isPainZone } from "./finding-sentence";
import {
  type FindingRow,
  orderFindings,
  type StaleRow,
} from "./findings-order";
import type { ReportRow } from "./scan-panel-model";

export type FindingGroupModel = {
  key: string;
  name: string;
  severity: "violation" | "warning";
  rows: FindingRow[];
};

const FIXED: { key: string; name: string }[] = [
  { key: "kind:rule-violation", name: "Policy violation" },
  { key: "kind:cycle", name: "Cyclic dependency" },
  { key: "kind:folder_cycle", name: "Folder cycle" },
  { key: "kind:hub", name: "Hub" },
  { key: "kind:orphan", name: "Orphan" },
  { key: "kind:policy_drift", name: "Policy drift" },
  { key: "kind:stable_dependencies", name: "Unstable dependency" },
  { key: "zone:pain", name: "Pain zone" },
  { key: "zone:useless", name: "Useless zone" },
  { key: "kind:unused_exports", name: "Unused exports" },
  { key: "kind:duplication", name: "Duplication" },
  { key: "kind:crap", name: "C.R.A.P." },
  { key: "kind:mutation", name: "Mutation" },
  { key: "kind:thresholds", name: "Threshold" },
];

export function kindLabel(kind: string): string {
  const words = kind.replace(/[-_]+/g, " ").trim();

  return words === "" ? kind : words[0]?.toUpperCase() + words.slice(1);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function groupOf(row: FindingRow): { key: string; name: string } {
  if (row.reported) {
    return { key: `report:${row.sensor}`, name: row.sensor };
  }

  const kind = row.kind.startsWith("thresholds.") ? "thresholds" : row.kind;
  const fixedKey =
    kind === "stable_abstractions"
      ? isPainZone(row.record)
        ? "zone:pain"
        : "zone:useless"
      : `kind:${kind}`;
  const fixed = FIXED.find((one) => one.key === fixedKey);

  return fixed ?? { key: `kind:${row.kind}`, name: kindLabel(row.kind) };
}

export function groupsOf(rows: FindingRow[]): FindingGroupModel[] {
  const ordered = orderFindings(rows);
  const byKey = new Map<string, FindingGroupModel>();

  for (const row of ordered) {
    const { key, name } = groupOf(row);
    const group = byKey.get(key) ?? {
      key,
      name,
      severity: "warning" as const,
      rows: [],
    };

    group.rows.push(row);

    if (row.severity === "violation") {
      group.severity = "violation";
    }

    byKey.set(key, group);
  }

  const all = [...byKey.values()];
  const fixed = FIXED.flatMap((one) => all.filter((g) => g.key === one.key));
  const reports = all.filter((g) => g.key.startsWith("report:"));
  const others = all
    .filter((g) => !fixed.includes(g) && !reports.includes(g))
    .sort((a, b) => compare(a.name, b.name));

  return [...fixed, ...reports, ...others];
}

export function headerLine(rows: FindingRow[]): string | null {
  if (rows.length === 0) {
    return null;
  }

  const violations = rows.filter((row) => row.severity === "violation").length;
  const warnings = rows.length - violations;
  const parts: string[] = [];

  if (violations > 0) {
    parts.push(
      `${violations} ${violations === 1 ? "violation" : "violations"}`,
    );
  }

  if (warnings > 0) {
    parts.push(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  }

  return parts.join(", ");
}

function joinNames(names: string[]): string {
  if (names.length <= 2) {
    return names.join(" and ");
  }

  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function staleNote(
  rows: FindingRow[],
  sensors: StaleRow[],
  reports: ReportRow[] = [],
): string | null {
  const stale = new Set([
    ...sensors
      .filter(
        (row) =>
          row.kind === "registered" &&
          (row.chip === "stale" || row.chip === "failed"),
      )
      .map((row) => row.name),
    ...reports.filter((row) => row.stale).map((row) => row.name),
  ]);

  const names = groupsOf(rows)
    .filter((group) => group.rows.some((row) => stale.has(row.sensor)))
    .map((group) => group.name);

  return names.length === 0
    ? null
    : `${joinNames(names)} findings are out of date.`;
}
