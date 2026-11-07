import groupFile from "./finding-groups.json";
import { type FindingRow, orderFindings } from "./findings-order";

export type GroupHelp = { means: string; todo: string };

type FixedGroup = { key: string; name: string; means?: string; todo?: string };

export type FindingGroupModel = {
  key: string;
  name: string;
  help: GroupHelp | null;
  severity: "violation" | "warning";
  rows: FindingRow[];
};

const FIXED: FixedGroup[] = groupFile.groups;

export function kindLabel(kind: string): string {
  const words = kind.replace(/[-_]+/g, " ").trim();

  return words === "" ? kind : words[0]?.toUpperCase() + words.slice(1);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function groupOf(row: FindingRow): {
  key: string;
  name: string;
  help: GroupHelp | null;
} {
  if (row.reported) {
    return { key: `report:${row.sensor}`, name: row.sensor, help: null };
  }

  const kind = row.kind.startsWith("thresholds.") ? "thresholds" : row.kind;
  const fixed = FIXED.find((one) => one.key === `kind:${kind}`);

  if (fixed) {
    return {
      key: fixed.key,
      name: fixed.name,
      help:
        fixed.means !== undefined && fixed.todo !== undefined
          ? { means: fixed.means, todo: fixed.todo }
          : null,
    };
  }

  return { key: `kind:${row.kind}`, name: kindLabel(row.kind), help: null };
}

export function groupsOf(rows: FindingRow[]): FindingGroupModel[] {
  const ordered = orderFindings(rows);
  const byKey = new Map<string, FindingGroupModel>();

  for (const row of ordered) {
    const { key, name, help } = groupOf(row);
    const group = byKey.get(key) ?? {
      key,
      name,
      help,
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

export const SENSOR_GROUPS: Record<string, string> = {
  "kind:duplication": "duplication",
  "kind:crap": "crap",
  "kind:mutation": "mutation",
  "kind:thresholds": "thresholds",
};

export function withEmptyGroups(
  groups: FindingGroupModel[],
  noneYet: (sensor: string) => boolean,
): FindingGroupModel[] {
  const present = new Set(groups.map(({ key }) => key));
  const added = FIXED.filter((one) => {
    const sensor = SENSOR_GROUPS[one.key];

    return sensor !== undefined && !present.has(one.key) && noneYet(sensor);
  }).map(
    (one): FindingGroupModel => ({
      key: one.key,
      name: one.name,
      help:
        one.means !== undefined && one.todo !== undefined
          ? { means: one.means, todo: one.todo }
          : null,
      severity: "warning",
      rows: [],
    }),
  );
  const all = [...groups, ...added];
  const fixed = FIXED.flatMap((one) => all.filter((g) => g.key === one.key));

  return [...fixed, ...groups.filter((g) => !fixed.includes(g))];
}
