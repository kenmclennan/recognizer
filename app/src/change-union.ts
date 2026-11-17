import type { Scan } from "recognizer";

export function unionScans(
  head: Scan[],
  base: Scan[] | null,
  removed: readonly string[],
): Scan[] {
  if (base === null || removed.length === 0) {
    return head;
  }

  const gone = new Set(removed);
  const present = new Set(
    head.flatMap((scan) => scan.modules.map((module) => module.id)),
  );
  const modules = new Map<string, Scan["modules"][number]>();

  for (const scan of base) {
    for (const module of scan.modules) {
      if (gone.has(module.id) && !present.has(module.id)) {
        modules.set(module.id, module);
      }
    }
  }

  if (modules.size === 0) {
    return head;
  }

  const inUnion = (id: string) => present.has(id) || modules.has(id);
  const edges = base
    .flatMap((scan) => scan.edges)
    .filter(
      (edge) =>
        (modules.has(edge.from) || modules.has(edge.to)) &&
        inUnion(edge.from) &&
        inUnion(edge.to),
    );

  return [...head, { modules: [...modules.values()], edges, foreign: [] }];
}
