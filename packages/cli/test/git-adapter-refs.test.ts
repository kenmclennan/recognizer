import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { GitAdapter } from "../src/adapters/git/git-adapter.js";
import { type Io, nodeIo } from "../src/cli.js";

function git(root: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(result.stderr);
  }

  return result.stdout.trim();
}

function repositoryWithRename(): {
  root: string;
  first: string;
  second: string;
} {
  const root = makeTempDir("recognizer-git-refs-");

  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, "old.txt"), "one\ntwo\nthree\nfour\nfive\n");
  git(root, "add", "old.txt");
  git(root, "commit", "-q", "-m", "first");

  const first = git(root, "rev-parse", "HEAD");

  git(root, "mv", "old.txt", "new.txt");
  git(root, "commit", "-q", "-m", "second");

  return { root, first, second: git(root, "rev-parse", "HEAD") };
}

function counting(): { io: Io; runs: () => number } {
  let count = 0;
  const base = nodeIo();

  return {
    io: {
      ...base,
      run: (...args) => {
        count += 1;

        return base.run(...args);
      },
    },
    runs: () => count,
  };
}

describe("git adapter refs", () => {
  it("resolves a valid ref to its commit", () => {
    const { root, second } = repositoryWithRename();

    expect(new GitAdapter(nodeIo()).resolveRef(root, "main")).toBe(second);
  });

  it("returns null for an invalid ref without running git", () => {
    const { root } = repositoryWithRename();
    const { io, runs } = counting();

    expect(new GitAdapter(io).resolveRef(root, "--x")).toBeNull();
    expect(new GitAdapter(io).resolveRef(root, "a..b")).toBeNull();
    expect(runs()).toBe(0);
    expect(new GitAdapter(io).resolveRef(root, "missing")).toBeNull();
    expect(runs()).toBe(1);
  });

  it("tells an ancestor pair from its reverse", () => {
    const { root, first, second } = repositoryWithRename();
    const adapter = new GitAdapter(nodeIo());

    expect(adapter.isAncestor(root, first, second)).toBe(true);
    expect(adapter.isAncestor(root, second, first)).toBe(false);
  });

  it("lists a rename since a commit", () => {
    const { root, first } = repositoryWithRename();

    expect(
      new GitAdapter(nodeIo()).renamesSince(root, first).get("old.txt"),
    ).toBe("new.txt");
  });
});
