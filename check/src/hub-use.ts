import type { Scan, ScanEdge, ScanMember } from "./scan.js";

export interface HubUse {
  used_by: { module: string; names: string[] }[];
  lines?: number;
  members?: number;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function lastLine(member: ScanMember): number | undefined {
  if (member.line === undefined) {
    return undefined;
  }

  const reaches = [member.end_line ?? member.line];

  for (const method of member.methods ?? []) {
    reaches.push(method.end_line ?? method.line ?? 0);
  }

  for (const field of member.fields ?? []) {
    reaches.push(field.line);
  }

  return Math.max(...reaches);
}

export function hubUse(
  edges: ScanEdge[],
  module: Scan["modules"][number],
  importers: Set<string>,
): HubUse {
  const named = new Map<string, Set<string>>();
  const unknown = new Set<string>();

  for (const edge of edges) {
    if (edge.to !== module.id || !importers.has(edge.from)) {
      continue;
    }

    const edgeNames =
      edge.names !== undefined && edge.names.length > 0
        ? edge.names
        : edge.to_member !== undefined
          ? [edge.to_member]
          : [];

    if (edgeNames.length === 0) {
      unknown.add(edge.from);
      continue;
    }

    const seen = named.get(edge.from) ?? new Set<string>();

    for (const name of edgeNames) {
      seen.add(name);
    }

    named.set(edge.from, seen);
  }

  const used_by = [...importers].sort(byCodeUnit).map((importer) => ({
    module: importer,
    names: unknown.has(importer)
      ? []
      : [...(named.get(importer) ?? [])].sort(byCodeUnit),
  }));

  const result: HubUse = { used_by };

  if (module.members !== undefined) {
    result.members = module.members.length;

    const reaches = module.members
      .map(lastLine)
      .filter((line): line is number => line !== undefined);

    if (reaches.length > 0) {
      result.lines = Math.max(...reaches);
    }
  }

  return result;
}
