import type { ViewChange } from "recognizer";
import type {
  BranchTip,
  CommitDetail,
  PullDetail,
} from "./change-detail-parse";
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
