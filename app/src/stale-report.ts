import {
  moduleNames,
  resolveView,
  type Scan,
  type ScanEdge,
  type View,
  type ViewStep,
} from "recognizer";

export type Rename = { from: string; to: string };

export type MissingStep = {
  step: number;
  kind: ViewStep["kind"];
  path: string;
  renamedTo: string | null;
};

export type EdgeKey = { from: string; to: string; kind: ScanEdge["kind"] };

export type StaleReport = {
  missing: MissingStep[];
  changed: { removed: EdgeKey[]; added: EdgeKey[] } | null;
  newlyRelevant: string[] | null;
  unavailable: string | null;
};

type Committed = Scan & { commit?: string | null };

export function currentCommit(scans: Scan[]): string | null {
  for (const scan of scans as Committed[]) {
    if (typeof scan.commit === "string") {
      return scan.commit;
    }
  }

  return null;
}

function keyOf(edge: EdgeKey): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.kind}`;
}

function edgesOf(scans: Scan[]): Map<string, EdgeKey> {
  const edges = new Map<string, EdgeKey>();

  for (const scan of scans) {
    for (const { from, to, kind } of scan.edges) {
      edges.set(keyOf({ from, to, kind }), { from, to, kind });
    }
  }

  return edges;
}

function neighbourPairs(edges: Map<string, EdgeKey>): Set<string> {
  const pairs = new Set<string>();

  for (const { from, to } of edges.values()) {
    pairs.add(`${from}\u0000${to}`);
  }

  return pairs;
}

export function staleReport(input: {
  view: View;
  now: Scan[];
  before: Scan[] | null;
  renames: Rename[];
}): StaleReport {
  const { view, now, before: earlier, renames } = input;
  const resolved = resolveView(view, now);
  const current = new Set(moduleNames(now));
  const missing = resolved.unresolved.map((entry) => ({
    step: entry.step,
    kind: entry.kind,
    path: entry.path,
    renamedTo:
      entry.kind === "pick"
        ? (renames.find(
            (rename) => rename.from === entry.path && current.has(rename.to),
          )?.to ?? null)
        : null,
  }));
  const sameCommit = view.commit !== null && view.commit === currentCommit(now);

  if (sameCommit) {
    return {
      missing,
      changed: { removed: [], added: [] },
      newlyRelevant: [],
      unavailable: null,
    };
  }

  if (earlier === null) {
    return {
      missing,
      changed: null,
      newlyRelevant: null,
      unavailable:
        view.commit === null
          ? "view has no commit"
          : `commit ${view.commit} could not be scanned`,
    };
  }

  const inView = new Set(resolved.modules);
  const before = new Set(moduleNames(earlier));
  const both = new Set(resolved.modules.filter((id) => before.has(id)));
  const edgesNow = edgesOf(now);
  const edgesThen = edgesOf(earlier);
  const between = (edge: EdgeKey) => both.has(edge.from) && both.has(edge.to);
  const removed = [...edgesThen]
    .filter(([key, edge]) => between(edge) && !edgesNow.has(key))
    .map(([, edge]) => edge);
  const added = [...edgesNow]
    .filter(([key, edge]) => between(edge) && !edgesThen.has(key))
    .map(([, edge]) => edge);
  const pairsThen = neighbourPairs(edgesThen);
  const relevant = new Set<string>();

  for (const { from, to } of edgesNow.values()) {
    const toView = inView.has(to) && !inView.has(from);
    const fromView = inView.has(from) && !inView.has(to);
    const outside = toView ? from : fromView ? to : null;

    if (outside !== null && !pairsThen.has(`${from}\u0000${to}`)) {
      relevant.add(outside);
    }
  }

  return {
    missing,
    changed: { removed, added },
    newlyRelevant: [...relevant].sort((a, b) => a.localeCompare(b)),
    unavailable: null,
  };
}

export function hasEntries(report: StaleReport): boolean {
  return (
    report.missing.length > 0 ||
    report.unavailable !== null ||
    (report.changed?.removed.length ?? 0) > 0 ||
    (report.changed?.added.length ?? 0) > 0 ||
    (report.newlyRelevant?.length ?? 0) > 0
  );
}
