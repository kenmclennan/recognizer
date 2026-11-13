import type { ChangeClassification, FileChange, MarkScan } from "recognizer";
import { classifyChanges } from "recognizer";
import type { BranchRow, HistoryRow, PullRequestRow } from "./commits-parse";
import type { RefFacts } from "./commits-port";

export {
  type BranchRow,
  type Checks,
  checksOf,
  ghNotice,
  type HistoryRow,
  type PullRequestRow,
  parseBranches,
  parseHistory,
  parsePullRequests,
} from "./commits-parse";

export type Slot = "from" | "to";

export type PickRow = {
  kind: "commit" | "branch" | "pr";
  ref: string;
  label: string;
  sub: string;
  defaultFrom: string | null;
};

export type PickedRange = { base: string; head: string; defaulted: boolean };

export type BranchEntry = {
  row: BranchRow;
  facts: RefFacts | null;
  isDefault: boolean;
};

export type CommitsModel = {
  active: () => Slot;
  slot: (which: Slot) => PickRow | null;
  pick: (row: PickRow) => boolean;
  select: (which: Slot) => void;
  clear: (which: Slot) => void;
  swap: () => boolean;
  canSwap: () => boolean;
  range: () => PickedRange | null;
  rangeNote: () => string | null;
  shaded: (history: readonly string[]) => Set<string>;
};

function same(a: PickRow | null, b: PickRow): boolean {
  return a !== null && a.kind === b.kind && a.ref === b.ref;
}

export function createCommitsModel(): CommitsModel {
  const held: Record<Slot, PickRow | null> = { from: null, to: null };
  let active: Slot = "to";

  const model: CommitsModel = {
    active: () => active,
    slot: (which) => held[which],
    pick(row) {
      const other: Slot = active === "to" ? "from" : "to";

      if (same(held[other], row)) {
        return false;
      }

      held[active] = row;

      if (active === "to" && held.from === null) {
        active = "from";
      }

      return true;
    },
    select(which) {
      active = which;
    },
    clear(which) {
      held[which] = null;
      active = which;
    },
    canSwap: () => held.from !== null && held.to !== null,
    swap() {
      if (!model.canSwap()) {
        return false;
      }

      [held.from, held.to] = [held.to, held.from];

      return true;
    },
    range() {
      const to = held.to;

      if (to === null) {
        return null;
      }

      const base = held.from?.ref ?? to.defaultFrom;

      return base === null
        ? null
        : { base, head: to.ref, defaulted: held.from === null };
    },
    rangeNote() {
      const to = held.to;

      if (to === null || held.from !== null || to.defaultFrom !== null) {
        return null;
      }

      return to.kind === "commit"
        ? "no parent commit"
        : "no merge base with the default branch";
    },
    shaded(history) {
      const from = held.from;
      const to = held.to;

      if (from?.kind !== "commit" || to?.kind !== "commit") {
        return new Set();
      }

      const a = history.indexOf(from.ref);
      const b = history.indexOf(to.ref);

      if (a < 0 || b < 0) {
        return new Set();
      }

      return new Set(history.slice(Math.min(a, b) + 1, Math.max(a, b)));
    },
  };

  return model;
}

export function commitRow(row: HistoryRow): PickRow {
  return {
    kind: "commit",
    ref: row.sha,
    label: row.short,
    sub: row.subject,
    defaultFrom: row.parents[0] ?? null,
  };
}

export function branchRow(entry: BranchEntry): PickRow {
  return {
    kind: "branch",
    ref: entry.row.name,
    label: entry.row.name,
    sub: entry.isDefault ? "default branch" : "",
    defaultFrom: entry.facts?.mergeBase ?? null,
  };
}

export function pullRequestRow(
  row: PullRequestRow,
  facts: RefFacts | null,
): PickRow {
  return {
    kind: "pr",
    ref: row.sha,
    label: `#${row.number}`,
    sub: row.title,
    defaultFrom: facts?.mergeBase ?? null,
  };
}

export function orderBranches(
  rows: readonly BranchRow[],
  defaultRef: string | null,
  facts: ReadonlyMap<string, RefFacts>,
): BranchEntry[] {
  const local =
    defaultRef === null ? null : defaultRef.slice(defaultRef.indexOf("/") + 1);
  const entries = rows.map((row) => ({
    row,
    facts: facts.get(row.name) ?? null,
    isDefault: row.name === local,
  }));

  return [
    ...entries.filter((one) => one.isDefault),
    ...entries.filter((one) => !one.isDefault),
  ];
}

export type Classification = ChangeClassification;

export function classify(
  changes: readonly FileChange[] | null,
  scans: readonly MarkScan[] | null,
): Classification | null {
  return changes === null || scans === null || scans.length === 0
    ? null
    : classifyChanges([...changes], [...scans]);
}

export type Tone = "added" | "modified" | "removed";

export type Square = { tone: Tone; count: number };

export type Impact = {
  count: string;
  squares: Square[];
  elsewhere: string | null;
};

const TONES: Tone[] = ["added", "modified", "removed"];

export function onCanvas(classification: Classification): number {
  return (
    classification.added.length +
    classification.modified.length +
    classification.removed.length
  );
}

export function filesText(count: number): string {
  return count === 0 ? "no files" : count === 1 ? "1 file" : `${count} files`;
}

export function impactText(classification: Classification | null): Impact {
  if (classification === null) {
    return { count: "-", squares: [], elsewhere: null };
  }

  return {
    count: filesText(onCanvas(classification)),
    squares: TONES.map((tone) => ({
      tone,
      count: classification[tone].length,
    })).filter((square) => square.count > 0),
    elsewhere:
      classification.elsewhere.length === 0
        ? null
        : `+${classification.elsewhere.length} not on the canvas`,
  };
}

export type TipLine = {
  kind: "heading" | "group" | "file";
  text: string;
  tone?: Tone;
};

const TONE_WORDS: Record<Tone, string> = {
  added: "added",
  modified: "modified",
  removed: "removed",
};

export function impactTip(
  classification: Classification | null,
): TipLine[] | null {
  if (classification === null) {
    return null;
  }

  const total = onCanvas(classification);
  const lines: TipLine[] = [
    {
      kind: "heading",
      text:
        total === 0
          ? "Nothing on the canvas"
          : `${filesText(total)} on the canvas`,
    },
  ];

  for (const tone of TONES) {
    const files = classification[tone];

    if (files.length === 0) {
      continue;
    }

    lines.push({
      kind: "group",
      text: `${files.length} ${TONE_WORDS[tone]}`,
      tone,
    });

    for (const file of files) {
      lines.push({ kind: "file", text: file, tone });
    }
  }

  if (classification.elsewhere.length > 0) {
    lines.push({
      kind: "group",
      text: `${filesText(classification.elsewhere.length)} not on the canvas`,
    });

    for (const file of classification.elsewhere) {
      lines.push({ kind: "file", text: file });
    }
  }

  return lines;
}

export function titleTip(
  title: string,
  sha: string,
  author: string,
  time: number,
  now: number,
): string[] {
  return [title, sha, `${author} · ${ageOf(time, now)}`];
}

export function visibleRows<
  T extends { classification: Classification | null; slot: Slot | null },
>(rows: readonly T[], hide: boolean): { rows: T[]; hidden: number } {
  if (!hide) {
    return { rows: [...rows], hidden: 0 };
  }

  const kept = rows.filter(
    (row) =>
      row.slot !== null ||
      row.classification === null ||
      onCanvas(row.classification) > 0,
  );

  return { rows: kept, hidden: rows.length - kept.length };
}

export function openLabel(
  range: PickedRange | null,
  classification: Classification | null,
  loading: boolean,
  short: (ref: string) => string,
  toPicked: boolean,
): string {
  if (range === null) {
    return toPicked ? "pick From below" : "pick To below";
  }

  const name = `${short(range.base)}..${short(range.head)}`;

  if (loading) {
    return `Open ${name}`;
  }

  return `Open ${name} · ${classification === null ? "-" : filesText(onCanvas(classification))}`;
}

export function ageOf(seconds: number, now: number): string {
  const elapsed = Math.max(0, Math.floor(now / 1000) - seconds);
  const minutes = Math.floor(elapsed / 60);

  if (minutes < 1) {
    return "now";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);

  return days < 365 ? `${days}d` : `${Math.floor(days / 365)}y`;
}
