import type { FindingRecord } from "recognizer";
import type { FindingRow } from "./findings-order";

export type LitSet = Set<string>;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function evidenceLines(
  record: FindingRecord,
  offCanvas: readonly string[] = [],
): string[] {
  const { edges = [], members = [], measures = {} } = record.evidence;
  const lines = [
    ...edges.map((edge) =>
      edge.lines !== undefined && edge.lines.length > 0
        ? `${edge.from} -> ${edge.to} at line ${edge.lines.join(", ")}`
        : `${edge.from} -> ${edge.to}`,
    ),
    ...members.map((member) => `${member.module}: ${member.name}`),
    ...Object.keys(measures)
      .sort(compare)
      .map((key) => `${key}: ${measures[key]}`),
  ];

  if (offCanvas.length > 0) {
    lines.push(`not on the canvas: ${offCanvas.join(", ")}`);
  }

  return lines;
}

export function cardText(
  row: FindingRow,
  offCanvas: readonly string[] = [],
): string[] {
  const { record } = row;

  return [
    `${row.kind} - ${row.sensor}`,
    row.summary,
    ...evidenceLines(record, offCanvas),
    `Principle: ${row.principle}`,
    ...(record.fix_pattern === undefined ? [] : [`Fix: ${record.fix_pattern}`]),
  ];
}

export function offCanvasModules(
  record: FindingRecord,
  boxFor: (id: string) => string,
  boxIds: ReadonlySet<string>,
): string[] {
  const ids = new Set(record.evidence.modules);

  for (const edge of record.evidence.edges ?? []) {
    ids.add(edge.from);
    ids.add(edge.to);
  }

  return [...ids].filter((id) => !boxIds.has(boxFor(id)));
}

export function litSet(
  record: FindingRecord,
  boxFor: (id: string) => string,
  sceneLines: readonly string[],
  boxIds: ReadonlySet<string>,
): LitSet {
  const lit: LitSet = new Set();
  const light = (id: string) => {
    const box = boxFor(id);

    if (boxIds.has(box)) {
      lit.add(box);
    }

    return box;
  };

  for (const id of record.evidence.modules) {
    light(id);
  }

  for (const edge of record.evidence.edges ?? []) {
    const from = light(edge.from);
    const to = light(edge.to);

    if (from === to || !boxIds.has(from) || !boxIds.has(to)) {
      continue;
    }

    const prefix = `${from}>${to}:`;

    for (const line of sceneLines) {
      if (line.startsWith(prefix)) {
        lit.add(line);
      }
    }
  }

  return lit;
}
