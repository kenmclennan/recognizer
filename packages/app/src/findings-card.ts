import type { FindingRecord } from "recognizer";

export type LitSet = Set<string>;

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
