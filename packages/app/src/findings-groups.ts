import { EMPTY_CATALOG, type FindingCatalog } from "./finding-catalog";
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

export const STRUCTURE_OWNER: Record<string, string> = {
  "kind:duplication": "duplication",
};

export function ownerOf(
  catalog: FindingCatalog,
  key: string,
): string | undefined {
  return catalog.sensorOf(key) ?? STRUCTURE_OWNER[key];
}

export function groupOf(
  row: FindingRow,
  catalog: FindingCatalog = EMPTY_CATALOG,
): {
  key: string;
  name: string;
  help: GroupHelp | null;
} {
  if (row.reported) {
    return { key: `report:${row.sensor}`, name: row.sensor, help: null };
  }

  const planned = catalog.groupFor(row.kind);

  if (planned) {
    return { key: planned.key, name: planned.name, help: planned.help };
  }

  const fixed = FIXED.find((one) => one.key === `kind:${row.kind}`);

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

export function groupsOf(
  rows: FindingRow[],
  catalog: FindingCatalog = EMPTY_CATALOG,
): FindingGroupModel[] {
  const ordered = orderFindings(rows);
  const byKey = new Map<string, FindingGroupModel>();

  for (const row of ordered) {
    const { key, name, help } = groupOf(row, catalog);
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
  const structure = FIXED.flatMap((one) =>
    all.filter((g) => g.key === one.key),
  );
  const planned = catalog.groups.flatMap((one) =>
    all.filter((g) => g.key === one.key),
  );
  const fixed = [...new Set([...structure, ...planned])];
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

export function withEmptyGroups(
  groups: FindingGroupModel[],
  noneYet: (sensor: string) => boolean,
  catalog: FindingCatalog = EMPTY_CATALOG,
): FindingGroupModel[] {
  const present = new Set(groups.map(({ key }) => key));
  const empty = (
    key: string,
    name: string,
    help: GroupHelp | null,
  ): FindingGroupModel => ({
    key,
    name,
    help,
    severity: "warning",
    rows: [],
  });
  const structure = FIXED.filter((one) => {
    const sensor = STRUCTURE_OWNER[one.key];

    return sensor !== undefined && !present.has(one.key) && noneYet(sensor);
  }).map((one) =>
    empty(
      one.key,
      one.name,
      one.means !== undefined && one.todo !== undefined
        ? { means: one.means, todo: one.todo }
        : null,
    ),
  );
  const seen = new Set<string>();
  const planned = catalog.groups
    .filter((one) => {
      const wanted =
        !present.has(one.key) && !seen.has(one.key) && noneYet(one.sensor);

      seen.add(one.key);

      return wanted;
    })
    .map((one) => empty(one.key, one.name, one.help));
  const all = [...groups, ...structure, ...planned];
  const ordered = [
    ...FIXED.flatMap((one) => all.filter((g) => g.key === one.key)),
    ...catalog.groups
      .flatMap((one) => all.filter((g) => g.key === one.key))
      .filter((g, at, list) => list.indexOf(g) === at),
  ];

  return [...ordered, ...groups.filter((g) => !ordered.includes(g))];
}
