import type { FindingRecord } from "../findings-document.js";
import { principleOf } from "../principles.js";
import {
  type Pair,
  prunedPairs,
  roundPercent,
  roundSimilarity,
} from "./score.js";
import { compareCodePoints } from "./syntax.js";

export const PRINCIPLE = "dont-repeat-yourself";
export const FIX_PATTERN = "extract-shared-function";

export interface DuplicationSettings {
  threshold: number;
  min_lines: number;
  pair_min_lines: number;
  min_nodes: number;
}

export const DEFAULT_DUPLICATION_SETTINGS: DuplicationSettings = {
  threshold: 0.82,
  min_lines: 4,
  pair_min_lines: 6,
  min_nodes: 20,
};

export interface Unit {
  module: string;
  file: string;
  qualified: string;
  startLine: number;
  endLine: number;
  startIndex: number;
  endIndex: number;
  fingerprints: ReadonlySet<string>;
  identity: string;
}

export function nested(a: Unit, b: Unit): boolean {
  if (a.file !== b.file) {
    return false;
  }

  return (
    (a.startIndex <= b.startIndex && b.endIndex <= a.endIndex) ||
    (b.startIndex <= a.startIndex && a.endIndex <= b.endIndex)
  );
}

function memberOf(unit: Unit) {
  return {
    module: unit.module,
    name: unit.qualified,
    file: unit.file,
    lines: [unit.startLine, unit.endLine] as [number, number],
  };
}

function sharedPrefix(members: readonly Unit[]): string | null {
  if (new Set(members.map((unit) => unit.file)).size !== 1) {
    return null;
  }

  const prefixes = new Set(
    members.map((unit) => {
      const dot = unit.qualified.lastIndexOf(".");

      return dot === -1 ? "" : unit.qualified.slice(0, dot);
    }),
  );

  if (prefixes.size !== 1) {
    return null;
  }

  const [prefix] = prefixes;

  return prefix === "" || prefix === undefined ? null : prefix;
}

export function linesOf(finding: FindingRecord): number {
  return (finding.evidence.members ?? []).reduce(
    (sum, member) =>
      sum +
      ((member.lines as [number, number])[1] -
        (member.lines as [number, number])[0] +
        1),
    0,
  );
}

export function findingFor(
  unsorted: readonly Unit[],
  score: number,
): FindingRecord {
  const members = [...unsorted].sort((a, b) =>
    compareCodePoints(a.identity, b.identity),
  );
  const first = members[0] as Unit;
  const second = members[1] as Unit;

  let id: string;
  let summary: string;

  if (members.length === 2) {
    id = `duplication:${first.identity}|${second.identity}`;
    summary = `${first.qualified} in ${first.module} is ${roundPercent(score)}% similar to ${second.qualified} in ${second.module}`;
  } else {
    id = `duplication:${first.identity}|${second.identity}#${members.length}`;

    const prefix = sharedPrefix(members);

    summary =
      prefix === null
        ? `${members.length} functions share one structure: ${members.map((unit) => `${unit.qualified} in ${unit.module}`).join(", ")}`
        : `${members.length} methods of ${prefix} share one structure`;
  }

  return {
    id,
    kind: "duplication",
    severity: "warning",
    ...principleOf(PRINCIPLE),
    fix_pattern: FIX_PATTERN,
    summary,
    evidence: {
      modules: [...new Set(members.map((unit) => unit.module))].sort(
        compareCodePoints,
      ),
      members: members.map(memberOf),
      measures: { similarity: roundSimilarity(score) },
    },
  };
}

export function families(
  edges: readonly (readonly [number, number, number])[],
): [number[], number][] {
  const parent = new Map<number, number>();

  const find = (start: number): number => {
    let node = start;

    if (!parent.has(node)) {
      parent.set(node, node);
    }

    while (parent.get(node) !== node) {
      const up = parent.get(node) as number;
      const grand = parent.get(up) as number;

      parent.set(node, grand);
      node = grand;
    }

    return node;
  };

  for (const [i, j] of edges) {
    parent.set(find(i), find(j));
  }

  const members = new Map<number, Set<number>>();
  const lowest = new Map<number, number>();

  for (const [i, j, score] of edges) {
    const root = find(i);
    const set = members.get(root) ?? new Set<number>();

    set.add(i);
    set.add(j);
    members.set(root, set);
    lowest.set(root, Math.min(lowest.get(root) ?? score, score));
  }

  return [...members].map(([root, nodes]) => [
    [...nodes].sort((a, b) => a - b),
    lowest.get(root) as number,
  ]);
}

export function findingsForUnits(
  units: readonly Unit[],
  settings: DuplicationSettings,
): FindingRecord[] {
  const sets = units.map((unit) => unit.fingerprints);
  const edges = prunedPairs(sets, settings.threshold)
    .filter(([i, j]: Pair) => !nested(units[i] as Unit, units[j] as Unit))
    .map(
      ([i, j, intersection, union]: Pair) =>
        [i, j, intersection / union] as const,
    );
  const pairFloor = Math.max(settings.min_lines, settings.pair_min_lines);
  const findings: FindingRecord[] = [];

  for (const [indices, score] of families(edges)) {
    const members = indices.map((index) => units[index] as Unit);

    if (
      members.length === 2 &&
      Math.min(...members.map((u) => u.endLine - u.startLine + 1)) < pairFloor
    ) {
      continue;
    }

    findings.push(findingFor(members, score));
  }

  return findings;
}

export function orderFindings(findings: FindingRecord[]): FindingRecord[] {
  return [...findings].sort(
    (a, b) => linesOf(b) - linesOf(a) || compareCodePoints(a.id, b.id),
  );
}
