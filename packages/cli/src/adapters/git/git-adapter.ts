import { type Git, ViewRange } from "@recognizer/core";
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
}
