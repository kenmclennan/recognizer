export type FileCounts = {
  added: number;
  modified: number;
  removed: number;
};

export type HistoryRow = {
  sha: string;
  short: string;
  parents: string[];
  author: string;
  time: number;
  subject: string;
  chips: string[];
  counts: FileCounts;
};

export type BranchRow = {
  name: string;
  short: string;
  author: string;
  time: number;
};

export type Checks = "passing" | "failing" | "pending" | "none";

export type PullRequestRow = {
  number: number;
  title: string;
  branch: string;
  sha: string;
  author: string;
  time: number;
  draft: boolean;
  checks: Checks;
};

export type Parsed<Row> = { rows: Row[]; skipped: number };

const SHA = /^[0-9a-f]{40,64}$/;
const REMOTES = new Set(["origin", "upstream"]);

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

function countsOf(lines: string[]): FileCounts {
  const counts: FileCounts = { added: 0, modified: 0, removed: 0 };

  for (const line of lines) {
    const status = line.split("\t")[0];

    if (status === "A") {
      counts.added += 1;
    } else if (status === "M" || status === "T") {
      counts.modified += 1;
    } else if (status === "D") {
      counts.removed += 1;
    }
  }

  return counts;
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
      counts: countsOf(rest),
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

type Check = {
  status?: unknown;
  conclusion?: unknown;
  state?: unknown;
};

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

export function ghNotice(status: string, detail: string): string | null {
  switch (status) {
    case "missing":
      return "Pull requests need the GitHub CLI (gh). Install it from cli.github.com, then reopen this tab.";
    case "signed-out":
      return "Sign in to the GitHub CLI with gh auth login, then reopen this tab.";
    case "failed":
      return detail;
    default:
      return null;
  }
}
