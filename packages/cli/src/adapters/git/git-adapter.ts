import { readdirSync, readFileSync, statSync } from "node:fs";
import {
  type Git,
  type GitText,
  type NameStatusEntry,
  ViewRange,
  type WorkingTreeEntry,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { isDirty, resolveCommit } from "../../scan-facts.js";

function parseRenames(stdout: string): Map<string, string> {
  const tokens = stdout.split("\0").filter((token) => token !== "");
  const renames = new Map<string, string>();

  for (let index = 0; index + 2 < tokens.length; index += 3) {
    if ((tokens[index] as string).startsWith("R")) {
      renames.set(tokens[index + 1] as string, tokens[index + 2] as string);
    }
  }

  return renames;
}

const COMMIT = /^[0-9a-f]{7,64}$/;
const STATUSES = new Set(["A", "M", "D", "T"]);

function parseNameStatus(stdout: string): NameStatusEntry[] {
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

const HISTORY_FORMAT = "--format=%x1e%H%x1f%h%x1f%P%x1f%an%x1f%ct%x1f%s%x1f%D";
const BRANCH_FORMAT =
  "--format=%(refname:short)%1f%(objectname:short)%1f%(authorname)%1f%(committerdate:unix)";

function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").trim();
}

function stampOf(path: string): string {
  try {
    const meta = statSync(path);

    return `${meta.size}:${meta.mtimeMs}`;
  } catch {
    return "-";
  }
}

function refStamps(directory: string, found: string[]): void {
  let entries: import("node:fs").Dirent[];

  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;

    if (entry.isDirectory()) {
      refStamps(path, found);
    } else {
      found.push(`${path}\t${stampOf(path)}`);
    }
  }
}

export class GitAdapter implements Git {
  constructor(private readonly io: Io) {}

  private text(root: string, args: string[]): string | null {
    const result = this.io.run("git", ["-C", root, ...args]);
    const text = result.stdout.trim();

    return result.started && result.status === 0 && text !== "" ? text : null;
  }

  private async textAsync(
    root: string,
    args: string[],
  ): Promise<string | null> {
    const result = await this.io.runAsync("git", ["-C", root, ...args]).result;
    const text = result.stdout.trim();

    return result.started && result.status === 0 && text !== "" ? text : null;
  }

  branch(root: string): string | null {
    return this.text(root, ["symbolic-ref", "--short", "-q", "HEAD"]);
  }

  insideWorkTree(root: string): boolean {
    return this.text(root, ["rev-parse", "--is-inside-work-tree"]) === "true";
  }

  listFiles(root: string): readonly string[] | null {
    if (!this.insideWorkTree(root)) {
      return null;
    }

    const result = this.io.run("git", [
      "-C",
      root,
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ]);

    return result.started && result.status === 0
      ? result.stdout.split("\0").filter((path) => path !== "")
      : [];
  }

  defaultRef(root: string): string | null {
    const name = this.text(root, [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);

    return name !== null && ViewRange.isValidRef(name) ? name : null;
  }

  async history(root: string, limit: number): Promise<GitText> {
    const result = await this.io.runAsync("git", [
      "-C",
      root,
      "-c",
      "core.quotePath=false",
      "log",
      "-n",
      String(limit),
      "-M",
      "--diff-merges=first-parent",
      "--name-status",
      HISTORY_FORMAT,
      "HEAD",
    ]).result;

    return result.started && result.status === 0
      ? { ok: true, text: result.stdout }
      : { ok: false, error: firstLine(result.stderr) };
  }

  async branches(root: string, limit: number): Promise<GitText> {
    const result = await this.io.runAsync("git", [
      "-C",
      root,
      "for-each-ref",
      "--sort=-committerdate",
      `--count=${limit}`,
      BRANCH_FORMAT,
      "refs/heads",
    ]).result;

    return result.started && result.status === 0
      ? { ok: true, text: result.stdout }
      : { ok: false, error: firstLine(result.stderr) };
  }

  async branchCount(root: string): Promise<number | null> {
    const result = await this.io.runAsync("git", [
      "-C",
      root,
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads",
    ]).result;

    return result.started && result.status === 0
      ? result.stdout.split("\n").filter((line) => line !== "").length
      : null;
  }

  async mergeBase(root: string, a: string, b: string): Promise<string | null> {
    if (!ViewRange.isValidRef(a) || !ViewRange.isValidRef(b)) {
      return null;
    }

    const sha = await this.textAsync(root, ["merge-base", a, b]);

    return sha !== null && /^[0-9a-fA-F]+$/.test(sha) ? sha : null;
  }

  async aheadBehind(
    root: string,
    base: string,
    head: string,
  ): Promise<{ behind: number; ahead: number } | null> {
    if (!ViewRange.isValidRef(base) || !ViewRange.isValidRef(head)) {
      return null;
    }

    const counts = await this.textAsync(root, [
      "rev-list",
      "--left-right",
      "--count",
      `${base}...${head}`,
    ]);

    if (counts === null) {
      return null;
    }

    const [behind, ahead] = counts.split(/\s+/).map((part) => Number(part));

    return Number.isInteger(behind) && Number.isInteger(ahead)
      ? { behind: behind as number, ahead: ahead as number }
      : null;
  }

  async diffRefs(
    root: string,
    base: string,
    head: string,
  ): Promise<readonly NameStatusEntry[] | null> {
    if (!ViewRange.isValidRef(base) || !ViewRange.isValidRef(head)) {
      return null;
    }

    const result = await this.io.runAsync("git", [
      "-C",
      root,
      "diff",
      "-M",
      "--name-status",
      "-z",
      `${base}...${head}`,
    ]).result;

    return result.started && result.status === 0
      ? parseNameStatus(result.stdout)
      : null;
  }

  async commitDetail(root: string, ref: string): Promise<string | null> {
    if (!ViewRange.isValidRef(ref)) {
      return null;
    }

    const result = await this.io.runAsync("git", [
      "-C",
      root,
      "show",
      "-s",
      "--format=%an%x1f%ct%x1f%B",
      `${ref}^{commit}`,
    ]).result;

    return result.started && result.status === 0 ? result.stdout : null;
  }

  async tipSummary(root: string, ref: string): Promise<string | null> {
    if (!ViewRange.isValidRef(ref)) {
      return null;
    }

    const result = await this.io.runAsync("git", [
      "-C",
      root,
      "log",
      "-1",
      "--format=%an%x1f%ct%x1f%s",
      `${ref}^{commit}`,
    ]).result;

    return result.started && result.status === 0 ? result.stdout : null;
  }

  async workingTree(root: string): Promise<readonly WorkingTreeEntry[] | null> {
    const result = await this.io.runAsync("git", [
      "-C",
      root,
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
      ":!.recognizer",
    ]).result;

    if (!result.started || result.status !== 0) {
      return null;
    }

    const tokens = result.stdout
      .split("\u0000")
      .filter((token) => token !== "");
    const entries: WorkingTreeEntry[] = [];

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index] as string;

      if (token.length < 4) {
        continue;
      }

      const code = token.slice(0, 2);

      if (code.includes("R") || code.includes("C")) {
        index += 1;
      }

      entries.push({ code, path: token.slice(3) });
    }

    return entries;
  }

  async stateSnapshot(root: string): Promise<string | null> {
    const paths = await this.textAsync(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "HEAD",
      "--git-path",
      "FETCH_HEAD",
      "--git-path",
      "packed-refs",
      "--git-path",
      "refs",
    ]);

    if (paths === null) {
      return null;
    }

    const lines = paths.split("\n");

    if (lines.length !== 4) {
      return null;
    }

    const [head, fetchHead, packedRefs, refs] = lines as [
      string,
      string,
      string,
      string,
    ];
    const found: string[] = [];

    refStamps(refs, found);
    found.sort();

    let headText = "-";

    try {
      headText = readFileSync(head, "utf8");
    } catch {}

    return [headText, stampOf(fetchHead), stampOf(packedRefs), ...found].join(
      "\u0000",
    );
  }

  commit(root: string): string | null {
    return resolveCommit(this.io, root);
  }

  dirty(root: string): boolean {
    return isDirty(this.io, root);
  }

  resolveRef(root: string, ref: string): string | null {
    if (!ViewRange.isValidRef(ref)) {
      return null;
    }

    const result = this.io.run("git", [
      "-C",
      root,
      "rev-parse",
      "--verify",
      "-q",
      `${ref}^{commit}`,
    ]);
    const commit = result.stdout.trim();

    return result.started && result.status === 0 && commit !== ""
      ? commit
      : null;
  }

  isAncestor(root: string, ancestor: string, descendant: string): boolean {
    const result = this.io.run("git", [
      "-C",
      root,
      "merge-base",
      "--is-ancestor",
      ancestor,
      descendant,
    ]);

    return result.started && result.status === 0;
  }

  renamesSince(root: string, commit: string): ReadonlyMap<string, string> {
    const result = this.io.run("git", [
      "-C",
      root,
      "diff",
      "-M",
      "--relative",
      "--name-status",
      "--diff-filter=R",
      "-z",
      commit,
    ]);

    return result.started && result.status === 0
      ? parseRenames(result.stdout)
      : new Map<string, string>();
  }

  nameStatus(
    root: string,
    base: string,
    head: string,
  ): readonly NameStatusEntry[] | null {
    if (!COMMIT.test(base) || !COMMIT.test(head)) {
      return null;
    }

    const result = this.io.run("git", [
      "-C",
      root,
      "diff",
      "-M",
      "--name-status",
      "-z",
      `${base}...${head}`,
    ]);

    return result.started && result.status === 0
      ? parseNameStatus(result.stdout)
      : null;
  }

  userName(root: string): string | null {
    const result = this.io.run("git", ["-C", root, "config", "user.name"]);

    return result.started && result.status === 0 && result.stdout.trim() !== ""
      ? result.stdout
      : null;
  }

  async showText(
    root: string,
    commit: string,
    path: string,
    limit: number,
  ): Promise<string | null> {
    if (!COMMIT.test(commit)) {
      return null;
    }

    const result = await this.io.runAsync("git", [
      "-C",
      root,
      "show",
      `${commit}:${path}`,
    ]).result;

    if (
      !result.started ||
      result.status !== 0 ||
      Buffer.byteLength(result.stdout) > limit ||
      result.stdout.includes("\uFFFD")
    ) {
      return null;
    }

    return result.stdout;
  }

  async archive(
    root: string,
    commit: string,
    paths: readonly string[],
    target: string,
  ): Promise<boolean> {
    if (!COMMIT.test(commit)) {
      return false;
    }

    const tarball = `${target}.tar`;

    try {
      const archived = await this.io.runAsync("git", [
        "-C",
        root,
        ...(paths.length > 0 ? ["--literal-pathspecs"] : []),
        "archive",
        "--format=tar",
        `--output=${tarball}`,
        commit,
        ...(paths.length > 0 ? ["--", ...paths] : []),
      ]).result;

      if (!archived.started || archived.status !== 0) {
        return false;
      }

      const unpacked = await this.io.runAsync("tar", [
        "-x",
        "-C",
        target,
        "-f",
        tarball,
      ]).result;

      return unpacked.started && unpacked.status === 0;
    } finally {
      this.io.remove(tarball);
    }
  }
}
