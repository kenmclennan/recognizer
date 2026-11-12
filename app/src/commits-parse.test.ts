import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checksOf,
  ghNotice,
  parseBranches,
  parseHistory,
  parsePullRequests,
} from "./commits-parse";

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../fixtures/commits/${name}`, import.meta.url),
    "utf8",
  );

describe("parseHistory", () => {
  const { rows, skipped } = parseHistory(fixture("history.txt"));

  it("reads every field of an ordinary commit with its added, modified and removed counts", () => {
    expect(skipped).toBe(0);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      sha: "a".repeat(40),
      short: "aaaaaaa",
      parents: ["b".repeat(40)],
      author: "Ken",
      time: 1700000000,
      subject: "Add cart discounts",
      chips: ["main", "v0.4.0", "feature/x"],
      counts: { added: 1, modified: 2, removed: 1 },
    });
  });

  it("keeps a merge commit's two parents and the counts against its first parent", () => {
    expect(rows[1]?.parents).toEqual(["c".repeat(40), "d".repeat(40)]);
    expect(rows[1]?.counts).toEqual({ added: 1, modified: 1, removed: 0 });
  });

  it("gives a commit with no files zero counts and no chips", () => {
    expect(rows[2]?.counts).toEqual({ added: 0, modified: 0, removed: 0 });
    expect(rows[2]?.chips).toEqual([]);
  });

  it("shows branch and tag chips but never a remote ref or the HEAD arrow", () => {
    const chips = rows.flatMap((row) => row.chips);

    expect(chips).toEqual(["main", "v0.4.0", "feature/x"]);
    expect(chips.some((chip) => chip.startsWith("origin/"))).toBe(false);
    expect(chips.some((chip) => chip.includes("HEAD"))).toBe(false);
  });

  it("skips and counts a malformed record instead of throwing", () => {
    const result = parseHistory(fixture("history-with-bad-record.txt"));

    expect(result.skipped).toBe(1);
    expect(result.rows.map((row) => row.short)).toEqual(["aaaaaaa", "bbbbbbb"]);
  });
});

describe("parseBranches", () => {
  it("reads name, short sha, author and time of each line", () => {
    const { rows, skipped } = parseBranches(fixture("branches.txt"));

    expect(skipped).toBe(0);
    expect(rows).toEqual([
      { name: "main", short: "1234567", author: "Ken", time: 1700000000 },
      { name: "feature/x", short: "89abcde", author: "lc", time: 1699000000 },
      { name: "spike", short: "fedcba9", author: "Ken", time: 1690000000 },
    ]);
  });

  it("skips and counts a line without a time", () => {
    const result = parseBranches("main\u001f1234567\u001fKen\u001f1\nbroken\n");

    expect(result.skipped).toBe(1);
    expect(result.rows.map((row) => row.name)).toEqual(["main"]);
  });
});

describe("parsePullRequests", () => {
  const { rows, skipped } = parsePullRequests(fixture("pull-requests.json"));

  it("reads every field, the draft flag and the checks of each pull request", () => {
    expect(skipped).toBe(0);
    expect(rows.map((row) => [row.number, row.draft, row.checks])).toEqual([
      [3, true, "none"],
      [4, false, "none"],
      [5, false, "failing"],
      [6, false, "pending"],
      [8, false, "pending"],
    ]);
    expect(rows[0]).toEqual({
      number: 3,
      title: "Draft work",
      branch: "feature/draft",
      sha: "1".repeat(40),
      author: "lc",
      time: Date.parse("2026-11-10T10:00:00Z") / 1000,
      draft: true,
      checks: "none",
    });
  });

  it("skips a record with no head sha and treats invalid json as one skipped record", () => {
    expect(parsePullRequests('[{"number":1,"title":"t"}]')).toEqual({
      rows: [],
      skipped: 1,
    });
    expect(parsePullRequests("not json")).toEqual({ rows: [], skipped: 1 });
  });
});

describe("checksOf", () => {
  it("is none for no checks, passing for all passing, pending for one running and failing for any failure", () => {
    const done = (conclusion: string) => ({
      status: "COMPLETED",
      conclusion,
    });

    expect(checksOf([])).toBe("none");
    expect(checksOf(undefined)).toBe("none");
    expect(checksOf([done("SUCCESS"), done("SKIPPED")])).toBe("passing");
    expect(checksOf([{ status: "IN_PROGRESS", conclusion: "" }])).toBe(
      "pending",
    );
    expect(checksOf([{ state: "PENDING" }])).toBe("pending");
    expect(checksOf([{ state: "SUCCESS" }])).toBe("passing");
    expect(checksOf([done("FAILURE")])).toBe("failing");
    expect(checksOf([done("SUCCESS"), done("FAILURE")])).toBe("failing");
    expect(checksOf([{ status: "IN_PROGRESS" }, done("FAILURE")])).toBe(
      "failing",
    );
  });
});

describe("ghNotice", () => {
  it("returns the text for missing, signed-out and failed and nothing for ok", () => {
    expect(ghNotice("missing", "")).toBe(
      "Pull requests need the GitHub CLI (gh). Install it from cli.github.com, then reopen this tab.",
    );
    expect(ghNotice("signed-out", "")).toBe(
      "Sign in to the GitHub CLI with gh auth login, then reopen this tab.",
    );
    expect(ghNotice("failed", "rate limited")).toBe("rate limited");
    expect(ghNotice("ok", "")).toBeNull();
  });
});

describe("parseHistory over this repository's real committed history (non-gating)", () => {
  it("reads the checkout's first commit as HEAD and skips no record", () => {
    const root = new URL("../..", import.meta.url).pathname;
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });

    if (git("rev-parse", "--is-shallow-repository").trim() !== "false") {
      return;
    }

    const text = git(
      "log",
      "-n",
      "200",
      "--no-renames",
      "--diff-merges=first-parent",
      "--name-status",
      "--format=%x1e%H%x1f%h%x1f%P%x1f%an%x1f%ct%x1f%s%x1f%D",
      "HEAD",
    );
    const result = parseHistory(text);

    expect(result.rows[0]?.sha).toBe(git("rev-parse", "HEAD").trim());
    expect(result.skipped).toBe(0);
  });
});
