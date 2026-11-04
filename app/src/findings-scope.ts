import type { FindingRow } from "./findings-order";

export type ViewScope = { modules: Set<string> };

export function scopeOf(opened: Iterable<string>): ViewScope {
  return { modules: new Set(opened) };
}

function subjectIds(row: FindingRow): string[] {
  const { record } = row;
  const ids = [...record.evidence.modules];

  for (const member of record.evidence.members ?? []) {
    ids.push(member.module);
  }

  for (const edge of record.evidence.edges ?? []) {
    ids.push(edge.from, edge.to);
  }

  return ids;
}

export function inScope(row: FindingRow, scope: ViewScope): boolean {
  return subjectIds(row).some((id) => scope.modules.has(id));
}

export function scopedRows(rows: FindingRow[], scope: ViewScope): FindingRow[] {
  return rows.filter((row) => inScope(row, scope));
}

export function scopeCaption(name: string, count: number): string {
  return `${name}, ${count} ${count === 1 ? "module" : "modules"}`;
}
