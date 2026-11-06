export interface ModuleImport {
  from: string;
  to: string;
}

interface FolderEdge {
  from: string;
  to: string;
  weight: number;
}

const MAX_PASSES = 100;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function folderEdgesOf(
  folderOf: (id: string) => string,
  imports: ModuleImport[],
): FolderEdge[] {
  const weights = new Map<string, FolderEdge>();

  for (const edge of imports) {
    const from = folderOf(edge.from);
    const to = folderOf(edge.to);

    if (from === to) {
      continue;
    }

    const key = `${from}\0${to}`;
    const found = weights.get(key);

    if (found) {
      found.weight += 1;
    } else {
      weights.set(key, { from, to, weight: 1 });
    }
  }

  return [...weights.values()];
}

function firstOf(folders: Iterable<string>): string | undefined {
  let best: string | undefined;

  for (const folder of folders) {
    if (best === undefined || compare(folder, best) < 0) {
      best = folder;
    }
  }

  return best;
}

function eadesLinSmyth(folders: string[], edges: FolderEdge[]): string[] {
  const remaining = new Set(folders);
  const outWeight = new Map<string, number>();
  const inWeight = new Map<string, number>();
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();

  for (const folder of folders) {
    outWeight.set(folder, 0);
    inWeight.set(folder, 0);
    outCount.set(folder, 0);
    inCount.set(folder, 0);
  }

  for (const edge of edges) {
    outWeight.set(edge.from, (outWeight.get(edge.from) ?? 0) + edge.weight);
    inWeight.set(edge.to, (inWeight.get(edge.to) ?? 0) + edge.weight);
    outCount.set(edge.from, (outCount.get(edge.from) ?? 0) + 1);
    inCount.set(edge.to, (inCount.get(edge.to) ?? 0) + 1);
  }

  const head: string[] = [];
  const tail: string[] = [];

  const remove = (folder: string) => {
    remaining.delete(folder);

    for (const edge of edges) {
      if (edge.from === folder && remaining.has(edge.to)) {
        inWeight.set(edge.to, (inWeight.get(edge.to) ?? 0) - edge.weight);
        inCount.set(edge.to, (inCount.get(edge.to) ?? 0) - 1);
      }

      if (edge.to === folder && remaining.has(edge.from)) {
        outWeight.set(edge.from, (outWeight.get(edge.from) ?? 0) - edge.weight);
        outCount.set(edge.from, (outCount.get(edge.from) ?? 0) - 1);
      }
    }
  };

  while (remaining.size > 0) {
    const sink = firstOf(
      [...remaining].filter((folder) => outCount.get(folder) === 0),
    );

    if (sink !== undefined) {
      tail.unshift(sink);
      remove(sink);

      continue;
    }

    const source = firstOf(
      [...remaining].filter((folder) => inCount.get(folder) === 0),
    );

    if (source !== undefined) {
      head.push(source);
      remove(source);

      continue;
    }

    let best: string | undefined;
    let bestDelta = Number.NEGATIVE_INFINITY;

    for (const folder of [...remaining].sort(compare)) {
      const delta = (outWeight.get(folder) ?? 0) - (inWeight.get(folder) ?? 0);

      if (delta > bestDelta) {
        best = folder;
        bestDelta = delta;
      }
    }

    if (best === undefined) {
      break;
    }

    head.push(best);
    remove(best);
  }

  return [...head, ...tail];
}

function backWeight(order: string[], edges: FolderEdge[]): number {
  const position = new Map(order.map((folder, at) => [folder, at]));
  let total = 0;

  for (const edge of edges) {
    if ((position.get(edge.from) ?? 0) > (position.get(edge.to) ?? 0)) {
      total += edge.weight;
    }
  }

  return total;
}

function improve(initial: string[], edges: FolderEdge[]): string[] {
  let order = initial;

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let moved = false;

    for (const folder of [...order].sort(compare)) {
      const without = order.filter((other) => other !== folder);
      const current = backWeight(order, edges);
      let bestCost = current;
      let bestAt = -1;

      for (let at = 0; at <= without.length; at += 1) {
        const candidate = [
          ...without.slice(0, at),
          folder,
          ...without.slice(at),
        ];
        const cost = backWeight(candidate, edges);

        if (cost < bestCost) {
          bestCost = cost;
          bestAt = at;
        }
      }

      if (bestAt >= 0) {
        order = [...without.slice(0, bestAt), folder, ...without.slice(bestAt)];
        moved = true;
      }
    }

    if (!moved) {
      break;
    }
  }

  return order;
}

function reaches(
  successors: Map<string, string[]>,
  from: string,
  to: string,
): boolean {
  const seen = new Set<string>([from]);
  const stack = [from];

  while (stack.length > 0) {
    const node = stack.pop() as string;

    if (node === to) {
      return true;
    }

    for (const next of successors.get(node) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }

  return false;
}

function irredundant(order: string[], edges: FolderEdge[]): FolderEdge[] {
  const position = new Map(order.map((folder, at) => [folder, at]));
  const forward = edges.filter(
    (edge) => (position.get(edge.from) ?? 0) < (position.get(edge.to) ?? 0),
  );
  const successors = new Map<string, string[]>();

  for (const edge of forward) {
    successors.set(edge.from, [...(successors.get(edge.from) ?? []), edge.to]);
  }

  const backward = edges
    .filter(
      (edge) => (position.get(edge.from) ?? 0) > (position.get(edge.to) ?? 0),
    )
    .sort(
      (a, b) =>
        b.weight - a.weight || compare(a.from, b.from) || compare(a.to, b.to),
    );
  const kept: FolderEdge[] = [];

  for (const edge of backward) {
    if (reaches(successors, edge.to, edge.from)) {
      kept.push(edge);
    } else {
      successors.set(edge.from, [
        ...(successors.get(edge.from) ?? []),
        edge.to,
      ]);
    }
  }

  return kept;
}

export function cutSet(
  folderOf: (id: string) => string,
  imports: ModuleImport[],
): ModuleImport[] {
  const edges = folderEdgesOf(folderOf, imports).sort(
    (a, b) => compare(a.from, b.from) || compare(a.to, b.to),
  );
  const folders = [
    ...new Set(edges.flatMap((edge) => [edge.from, edge.to])),
  ].sort(compare);
  const order = improve(eadesLinSmyth(folders, edges), edges);
  const cut = irredundant(order, edges);
  const weightOf = new Map(
    cut.map((edge) => [`${edge.from}\0${edge.to}`, edge.weight]),
  );

  return imports
    .filter((edge) =>
      weightOf.has(`${folderOf(edge.from)}\0${folderOf(edge.to)}`),
    )
    .map((edge) => ({
      edge,
      source: folderOf(edge.from),
      target: folderOf(edge.to),
      weight: weightOf.get(`${folderOf(edge.from)}\0${folderOf(edge.to)}`) ?? 0,
    }))
    .sort(
      (a, b) =>
        a.weight - b.weight ||
        compare(a.source, b.source) ||
        compare(a.target, b.target) ||
        compare(a.edge.from, b.edge.from) ||
        compare(a.edge.to, b.edge.to),
    )
    .map(({ edge }) => ({ from: edge.from, to: edge.to }));
}

export function splitCandidates(
  folderEdges: { from: string; to: string }[],
  threshold: number,
): string[] {
  const importers = new Map<string, Set<string>>();
  const imported = new Map<string, Set<string>>();

  for (const edge of folderEdges) {
    if (edge.from === edge.to) {
      continue;
    }

    importers.set(
      edge.to,
      (importers.get(edge.to) ?? new Set()).add(edge.from),
    );
    imported.set(
      edge.from,
      (imported.get(edge.from) ?? new Set()).add(edge.to),
    );
  }

  return [...importers.keys()]
    .filter(
      (folder) =>
        (importers.get(folder)?.size ?? 0) >= threshold &&
        (imported.get(folder)?.size ?? 0) >= threshold,
    )
    .sort(compare);
}
