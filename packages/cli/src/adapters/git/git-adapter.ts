import { type Git, type NameStatusEntry, ViewRange } from "@recognizer/core";
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

export class GitAdapter implements Git {
  constructor(private readonly io: Io) {}

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
