import { folderSubject } from "./finding-card";
import type { FindingRow } from "./findings-order";

export type ViewScope = { modules: Set<string>; folders: Set<string> };

export function scopeOf(opened: Iterable<string>): ViewScope {
  const modules = new Set<string>();
  const folders = new Set<string>();

  for (const id of opened) {
    modules.add(id);

    let at = id.lastIndexOf("/");

    while (at > 0) {
      folders.add(id.slice(0, at));
      at = id.lastIndexOf("/", at - 1);
    }
  }

  return { modules, folders };
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

  const folder = folderSubject(record);

  if (folder !== null && folder !== "") {
    ids.push(folder);
  }

  return ids;
}

export function inScope(row: FindingRow, scope: ViewScope): boolean {
  return subjectIds(row).some(
    (id) => scope.modules.has(id) || scope.folders.has(id),
  );
}

export function scopedRows(rows: FindingRow[], scope: ViewScope): FindingRow[] {
  return rows.filter((row) => inScope(row, scope));
}

export function scopeCaption(name: string, count: number): string {
  return `${name}, ${count} ${count === 1 ? "module" : "modules"}`;
}
