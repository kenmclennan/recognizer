import type { Checks } from "./commits-parse";
import { checksOf } from "./commits-parse";
import type { PullRequestsReply } from "./commits-port";

export type CommitDetail = {
  author: string;
  time: number;
  subject: string;
  body: string;
};

export type BranchTip = { author: string; time: number; subject: string };

export type PullState = "open" | "draft" | "merged" | "closed";

export type PullDetail = {
  number: number;
  title: string;
  body: string;
  state: PullState;
  author: string;
  checks: Checks;
};

export function parseCommitDetail(text: string | null): CommitDetail | null {
  if (text === null) {
    return null;
  }

  const fields = text.split("\u001f");

  if (fields.length < 3) {
    return null;
  }

  const [author = "", time = ""] = fields;
  const seconds = Number(time.trim());

  if (time.trim() === "" || !Number.isFinite(seconds)) {
    return null;
  }

  const message = fields.slice(2).join("\u001f").replace(/\r\n/g, "\n");
  const newline = message.indexOf("\n");
  const subject = (newline < 0 ? message : message.slice(0, newline)).trim();
  const body = newline < 0 ? "" : message.slice(newline + 1).trim();

  return { author: author.trim(), time: seconds, subject, body };
}

export function parseBranchTip(text: string | null): BranchTip | null {
  const detail = parseCommitDetail(text);

  return detail === null
    ? null
    : { author: detail.author, time: detail.time, subject: detail.subject };
}

function stateOf(state: unknown, draft: boolean): PullState | null {
  if (state === undefined) {
    return draft ? "draft" : "open";
  }

  switch (state) {
    case "OPEN":
      return draft ? "draft" : "open";
    case "MERGED":
      return "merged";
    case "CLOSED":
      return "closed";
    default:
      return null;
  }
}

export function parsePullDetail(
  reply: PullRequestsReply | null,
): PullDetail | null {
  if (reply === null || reply.status !== "ok") {
    return null;
  }

  let found: unknown;

  try {
    found = JSON.parse(reply.text);
  } catch {
    return null;
  }

  const entry = Array.isArray(found) ? found[0] : found;

  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const one = entry as Record<string, unknown>;
  const state = stateOf(one.state, one.isDraft === true);

  if (
    typeof one.number !== "number" ||
    typeof one.title !== "string" ||
    state === null
  ) {
    return null;
  }

  const author = one.author as { login?: unknown; name?: unknown } | null;

  return {
    number: one.number,
    title: one.title,
    body: typeof one.body === "string" ? one.body : "",
    state,
    author: String(author?.login ?? author?.name ?? ""),
    checks: checksOf(one.statusCheckRollup),
  };
}
