import { changeChip, type ViewChange } from "recognizer";
import type {
  BranchTip,
  CommitDetail,
  PullDetail,
} from "./change-detail-parse";
import { filesText } from "./commits-panel-model";
import type { HistoryRow } from "./commits-parse";

export type ChangeKind =
  | { kind: "commit"; sha: string }
  | { kind: "branch"; name: string }
  | { kind: "pr"; number: number }
  | { kind: "range" }
  | { kind: "other" };

export type ChangeCounts = { onCanvas: number; elsewhere: number };

export type ChangeSummaryFacts = {
  commit: CommitDetail | null;
  tip: BranchTip | null;
  pull: PullDetail | null;
  defaultBranch: string | null;
  ahead: number | null;
  behind: number | null;
  rows: readonly HistoryRow[] | null;
  counts: ChangeCounts | null;
};

export type ChangeSummary = {
  title: string;
  chip: string;
  lead: string | null;
  facts: string[];
  saveDescription: string;
};

const VIEW_NAME_MAX = 64;
const SEPARATOR = " \u00b7 ";

export function kindOfChange(change: ViewChange): ChangeKind {
  const name = change.name;

  if (name === undefined) {
    return { kind: "other" };
  }

  const commit = /^commit ([0-9a-f]+)$/i.exec(name);

  if (commit !== null) {
    return { kind: "commit", sha: change.head };
  }

  const pull = /^pull request #(\d+)$/.exec(name);

  if (pull !== null) {
    return { kind: "pr", number: Number(pull[1]) };
  }

  const branch = /^branch (.+)$/.exec(name);

  if (branch !== null) {
    return branch[1] === change.head
      ? { kind: "branch", name: change.head }
      : { kind: "other" };
  }

  return /^\S+ to \S+$/.test(name) ? { kind: "range" } : { kind: "other" };
}

function normalised(text: string): string {
  return text
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function firstParagraph(
  body: string,
  title: string | null,
): string | null {
  const wanted = title === null ? null : normalised(title);
  const paragraphs = body
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .filter((paragraph) => wanted === null || normalised(paragraph) !== wanted);
  const first = paragraphs[0];

  return first === undefined ? null : first.replace(/\s+/g, " ");
}

export function viewNameFrom(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length <= VIEW_NAME_MAX) {
    return slug;
  }

  const kept =
    slug[VIEW_NAME_MAX] === "-"
      ? slug.slice(0, VIEW_NAME_MAX)
      : cutBack(slug.slice(0, VIEW_NAME_MAX));

  return kept.replace(/-+$/, "");
}

function cutBack(head: string): string {
  const dash = head.lastIndexOf("-");

  return dash > 0 ? head.slice(0, dash) : head;
}

function parts(seconds: number, zone: string) {
  const found = new Map<string, string>();

  for (const part of new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: zone,
  }).formatToParts(new Date(seconds * 1000))) {
    found.set(part.type, part.value);
  }

  return found;
}

export function formatDay(seconds: number, zone: string): string {
  const found = parts(seconds, zone);

  return `${found.get("day")} ${found.get("month")}`;
}

export function formatDate(seconds: number, zone: string): string {
  const found = parts(seconds, zone);

  return `${found.get("day")} ${found.get("month")} ${found.get("year")} ${found.get("hour")}:${found.get("minute")}`;
}

function joined(items: readonly (string | null)[]): string {
  return items.filter((item) => item !== null && item !== "").join(SEPARATOR);
}

function countsText(counts: ChangeCounts | null): string | null {
  if (counts === null) {
    return null;
  }

  const base = `${filesText(counts.onCanvas)} on the canvas`;

  return counts.elsewhere > 0
    ? `${base}, ${counts.elsewhere} not on the canvas`
    : base;
}

function aheadText(facts: ChangeSummaryFacts): string | null {
  if (facts.ahead === null || facts.behind === null) {
    return null;
  }

  const base = `${facts.ahead} ahead, ${facts.behind} behind`;

  return facts.defaultBranch === null ? base : `${base} ${facts.defaultBranch}`;
}

function lines(items: readonly string[]): string[] {
  return items.filter((item) => item !== "");
}

function pullTitle(pull: PullDetail): string {
  return `#${pull.number} ${pull.title}`;
}

export function summariseChange(
  change: ViewChange,
  facts: ChangeSummaryFacts,
  zone: string,
): ChangeSummary {
  const kind = kindOfChange(change);
  const plain = changeChip(change).text;
  const counts = countsText(facts.counts);
  let title = plain;
  let chip = plain;
  let lead: string | null = null;
  let shown: string[] = lines([counts ?? ""]);

  if (kind.kind === "commit") {
    const commit = facts.commit;

    if (commit !== null) {
      title = commit.subject === "" ? plain : commit.subject;
      chip = `${plain}${SEPARATOR}${formatDay(commit.time, zone)}`;
      lead = firstParagraph(commit.body, null);
    }

    shown = lines([
      joined([
        commit?.author ?? null,
        commit === null ? null : formatDate(commit.time, zone),
        counts,
      ]),
    ]);
  } else if (kind.kind === "pr") {
    const pull = facts.pull;

    if (pull !== null) {
      title = pullTitle(pull);
      lead = firstParagraph(pull.body, pull.title);
    }

    shown = lines([
      joined([
        pull?.author ?? null,
        pull?.state ?? null,
        pull === null || pull.checks === "none"
          ? null
          : `checks ${pull.checks}`,
        aheadText(facts),
        counts,
      ]),
    ]);
  }

  return {
    title,
    chip,
    lead,
    facts: shown,
    saveDescription:
      kind.kind === "branch" ? (shown[0] ?? "") : (lead ?? shown[0] ?? ""),
  };
}
