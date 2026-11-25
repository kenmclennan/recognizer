import type { NameStatusEntry } from "../shared/ports/git.js";

export interface HistoryRow {
  readonly sha: string;
  readonly short: string;
  readonly parents: string[];
  readonly author: string;
  readonly time: number;
  readonly subject: string;
  readonly chips: string[];
  readonly changes: NameStatusEntry[];
}

export interface BranchRow {
  readonly name: string;
  readonly short: string;
  readonly author: string;
  readonly time: number;
}

export type Checks = "passing" | "failing" | "pending" | "none";

export interface PullRequestRow {
  readonly number: number;
  readonly title: string;
  readonly branch: string;
  readonly sha: string;
  readonly author: string;
  readonly time: number;
  readonly draft: boolean;
  readonly checks: Checks;
}

export interface Parsed<Row> {
  readonly rows: Row[];
  readonly skipped: number;
}

const SHA = /^[0-9a-f]{40,64}$/;
const REMOTES = new Set(["origin", "upstream"]);
const STATUSES = new Set(["A", "M", "D", "T"]);

export function parseNameStatus(stdout: string): NameStatusEntry[] {
  const fields = stdout.split("\0");
  const entries: NameStatusEntry[] = [];
  let index = 0;

  while (index < fields.length) {
    const status = fields[index] as string;

    index += 1;

    if (status.startsWith("R")) {
      const from = fields[index];
      const path = fields[index + 1];

      index += 2;

      if (from !== undefined && path !== undefined) {
        entries.push({ status: "R", path, from });
      }

      continue;
    }

    const path = fields[index];

    index += 1;

    if (path === undefined) {
      break;
    }

    if (STATUSES.has(status)) {
      entries.push({ status: status as "A" | "M" | "D" | "T", path });
    }
  }

  return entries;
}

function chipsOf(decorations: string): string[] {
  const chips: string[] = [];

  for (const raw of decorations.split(",")) {
    const entry = raw.trim();

    if (entry === "" || entry === "HEAD") {
      continue;
    }

    const name = entry.startsWith("HEAD -> ")
      ? entry.slice("HEAD -> ".length)
      : entry.startsWith("tag: ")
        ? entry.slice("tag: ".length)
        : entry;

    if (REMOTES.has(name.split("/")[0] ?? "") && name.includes("/")) {
      continue;
    }

    chips.push(name);
  }

  return chips;
}

function changesOf(lines: string[]): NameStatusEntry[] {
  const changes: NameStatusEntry[] = [];

  for (const line of lines) {
    const tab = line.indexOf("\t");

    if (tab < 0) {
      continue;
    }

    const fields = line.split("\t");

    if (fields.length < 2 || fields.some((field) => field === "")) {
      continue;
    }

    const [entry] = parseNameStatus(`${fields.join("\0")}\0`);

    if (entry !== undefined) {
      changes.push(entry);
    }
  }

  return changes;
}

export function parseHistory(text: string): Parsed<HistoryRow> {
  const rows: HistoryRow[] = [];
  let skipped = 0;

  for (const record of text.split("\u001e")) {
    if (record.trim() === "") {
      continue;
    }

    const [header = "", ...rest] = record.split("\n");
    const fields = header.split("\u001f");
    const [sha = "", short = "", parents = "", author, time, subject] = fields;
    const seconds = Number(time);

    if (fields.length < 7 || !SHA.test(sha) || !Number.isFinite(seconds)) {
      skipped += 1;

      continue;
    }

    rows.push({
      sha,
      short,
      parents: parents.split(" ").filter((one) => one !== ""),
      author: author ?? "",
      time: seconds,
      subject: subject ?? "",
      chips: chipsOf(fields[6] ?? ""),
      changes: changesOf(rest),
    });
  }

  return { rows, skipped };
}

export function parseBranches(text: string): Parsed<BranchRow> {
  const rows: BranchRow[] = [];
  let skipped = 0;

  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    const [name = "", short = "", author = "", time = ""] =
      line.split("\u001f");
    const seconds = Number(time);

    if (name === "" || short === "" || !Number.isFinite(seconds)) {
      skipped += 1;

      continue;
    }

    rows.push({ name, short, author, time: seconds });
  }

  return { rows, skipped };
}

interface Check {
  status?: unknown;
  conclusion?: unknown;
  state?: unknown;
}

const FAILING = new Set([
  "FAILURE",
  "ERROR",
  "TIMED_OUT",
  "CANCELLED",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
]);

function checkOutcome(check: Check): Exclude<Checks, "none"> {
  if (typeof check.state === "string") {
    if (FAILING.has(check.state)) {
      return "failing";
    }

    return check.state === "SUCCESS" ? "passing" : "pending";
  }

  if (check.status !== "COMPLETED") {
    return "pending";
  }

  if (typeof check.conclusion === "string" && FAILING.has(check.conclusion)) {
    return "failing";
  }

  return "passing";
}

export function checksOf(rollup: unknown): Checks {
  if (!Array.isArray(rollup) || rollup.length === 0) {
    return "none";
  }

  const outcomes = rollup.map((entry) => checkOutcome(entry as Check));

  if (outcomes.includes("failing")) {
    return "failing";
  }

  return outcomes.includes("pending") ? "pending" : "passing";
}

function pullRequestOf(entry: unknown): PullRequestRow | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const one = entry as Record<string, unknown>;
  const author = one.author as { login?: unknown; name?: unknown } | null;
  const login = author?.login ?? author?.name ?? "";
  const time = Date.parse(String(one.updatedAt));

  if (
    typeof one.number !== "number" ||
    typeof one.title !== "string" ||
    typeof one.headRefName !== "string" ||
    typeof one.headRefOid !== "string" ||
    !SHA.test(one.headRefOid) ||
    Number.isNaN(time)
  ) {
    return null;
  }

  return {
    number: one.number,
    title: one.title,
    branch: one.headRefName,
    sha: one.headRefOid,
    author: String(login),
    time: Math.floor(time / 1000),
    draft: one.isDraft === true,
    checks: checksOf(one.statusCheckRollup),
  };
}

export function parsePullRequests(text: string): Parsed<PullRequestRow> {
  let found: unknown;

  try {
    found = JSON.parse(text);
  } catch {
    return { rows: [], skipped: 1 };
  }

  if (!Array.isArray(found)) {
    return { rows: [], skipped: 1 };
  }

  const rows: PullRequestRow[] = [];
  let skipped = 0;

  for (const entry of found) {
    const row = pullRequestOf(entry);

    if (row === null) {
      skipped += 1;
    } else {
      rows.push(row);
    }
  }

  return { rows, skipped };
}

export interface CommitDetail {
  readonly author: string;
  readonly time: number;
  readonly subject: string;
  readonly body: string;
}

export interface BranchTip {
  readonly author: string;
  readonly time: number;
  readonly subject: string;
}

export type PullState = "open" | "draft" | "merged" | "closed";

export interface PullDetail {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: PullState;
  readonly author: string;
  readonly checks: Checks;
}

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
  reply: { status: string; text: string } | null,
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
