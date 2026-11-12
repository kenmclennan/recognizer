import type {
  BranchRow,
  FileCounts,
  HistoryRow,
  PullRequestRow,
} from "./commits-parse";
import type { RefFacts } from "./commits-port";

export {
  type BranchRow,
  type Checks,
  checksOf,
  type FileCounts,
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

export function countsText(counts: FileCounts | null): string {
  return counts === null
    ? "-"
    : `+${counts.added} ~${counts.modified} -${counts.removed}`;
}

export function factsCounts(facts: RefFacts | null): FileCounts | null {
  return facts === null ||
    facts.added === null ||
    facts.modified === null ||
    facts.removed === null
    ? null
    : {
        added: facts.added,
        modified: facts.modified,
        removed: facts.removed,
      };
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
