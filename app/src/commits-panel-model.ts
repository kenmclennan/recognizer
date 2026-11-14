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

export type PickRow = {
  kind: "commit" | "branch" | "pr";
  ref: string;
  label: string;
  sub: string;
  defaultFrom: string | null;
};

export type BranchEntry = {
  row: BranchRow;
  facts: RefFacts | null;
  isDefault: boolean;
};

export type Mode = "one" | "range";

export type End = "first" | "last";

export type OpenRequest = {
  base: string;
  head: string;
  what: string;
  name: string;
};

export type CommitsTabName = "history" | "branches" | "prs";

export type Selection = {
  mode: () => Mode;
  setMode: (mode: Mode) => void;
  first: () => PickRow | null;
  last: () => PickRow | null;
  picked: () => PickRow | null;
  next: () => End;
  pick: (
    row: PickRow,
    tab: CommitsTabName,
    history: readonly string[],
  ) => OpenRequest | null;
  clear: (which: End) => void;
  keepOnly: (kind: PickRow["kind"], refs: readonly string[]) => void;
  count: (history: readonly string[]) => number | null;
  between: (history: readonly string[]) => Set<string>;
  note: () => string | null;
  guideLine: (
    tab: CommitsTabName,
    defaultName: string | null,
    history: readonly string[],
  ) => string;
};

function whatOf(row: PickRow): string {
  return row.kind === "commit"
    ? `commit ${row.label}`
    : row.kind === "branch"
      ? `branch ${row.label}`
      : `pull request ${row.label}`;
}

export function defaultBranchName(defaultRef: string | null): string | null {
  return defaultRef === null
    ? null
    : defaultRef.slice(defaultRef.indexOf("/") + 1);
}

export function createSelection(): Selection {
  let mode: Mode = "one";
  let first: PickRow | null = null;
  let last: PickRow | null = null;
  let picked: PickRow | null = null;
  let note: string | null = null;

  const reset = () => {
    first = null;
    last = null;
    picked = null;
    note = null;
  };

  const selection: Selection = {
    mode: () => mode,
    setMode(next) {
      mode = next;
      reset();
    },
    first: () => first,
    last: () => last,
    picked: () => picked,
    next: () => (first === null ? "first" : last === null ? "last" : "first"),
    pick(row, tab, history) {
      note = null;

      if (row.defaultFrom === null) {
        note =
          row.kind === "commit"
            ? "no parent commit"
            : "no merge base with the default branch";

        return null;
      }

      if (tab !== "history" || mode === "one") {
        picked = row;

        return {
          base: row.defaultFrom,
          head: row.ref,
          what: whatOf(row),
          name: whatOf(row),
        };
      }

      if (first === null || last !== null) {
        first = row;
        last = null;

        return null;
      }

      if (first.ref === row.ref) {
        first = null;

        return null;
      }

      const held = history.indexOf(first.ref);
      const clicked = history.indexOf(row.ref);
      const [older, newer] =
        held >= 0 && clicked >= 0 && clicked > held
          ? [row, first]
          : [first, row];

      if (older.defaultFrom === null) {
        note = "no parent commit";

        return null;
      }

      first = older;
      last = newer;

      return {
        base: older.defaultFrom,
        head: newer.ref,
        what: `range ${older.label} to ${newer.label}`,
        name: `${older.label} to ${newer.label}`,
      };
    },
    clear(which) {
      if (which === "first") {
        first = last;
      }

      last = null;
      note = null;
    },
    keepOnly(kind, refs) {
      const gone = (row: PickRow | null) =>
        row !== null && row.kind === kind && !refs.includes(row.ref);

      if (gone(first)) {
        first = null;
      }

      if (gone(last)) {
        last = null;
      }

      if (gone(picked)) {
        picked = null;
      }
    },
    count(history) {
      if (first === null || last === null) {
        return null;
      }

      const a = history.indexOf(first.ref);
      const b = history.indexOf(last.ref);

      return a < 0 || b < 0 ? null : Math.abs(a - b) + 1;
    },
    between(history) {
      if (first === null || last === null) {
        return new Set();
      }

      const a = history.indexOf(first.ref);
      const b = history.indexOf(last.ref);

      if (a < 0 || b < 0) {
        return new Set();
      }

      return new Set(history.slice(Math.min(a, b) + 1, Math.max(a, b)));
    },
    note: () => note,
    guideLine(tab, defaultName, history) {
      const name = defaultName ?? "the default branch";

      if (note !== null) {
        return note;
      }

      if (tab === "branches") {
        return `Each branch shows what it changes against ${name}.`;
      }

      if (tab === "prs") {
        return `Each pull request shows what it changes against ${name}.`;
      }

      if (mode === "one") {
        return "Click a commit to see what it changed.";
      }

      if (first === null) {
        return "Click the first commit of the range.";
      }

      if (last === null) {
        return "Now click the last commit.";
      }

      return `${selection.count(history) ?? 0} commits, both ends included.`;
    },
  };

  return selection;
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
  const local = defaultBranchName(defaultRef);
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
  T extends { classification: Classification | null; held: boolean },
>(rows: readonly T[], hide: boolean): { rows: T[]; hidden: number } {
  if (!hide) {
    return { rows: [...rows], hidden: 0 };
  }

  const kept = rows.filter(
    (row) =>
      row.held ||
      row.classification === null ||
      onCanvas(row.classification) > 0,
  );

  return { rows: kept, hidden: rows.length - kept.length };
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
