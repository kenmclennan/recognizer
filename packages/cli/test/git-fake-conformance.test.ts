import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Git } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { FakeGit } from "../../core/test/fakes/fake-git.js";
import { GitAdapter } from "../src/adapters/git/git-adapter.js";
import { nodeIo } from "../src/cli.js";

function git(root: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(result.stderr);
  }

  return result.stdout.trim();
}

function both(): { root: string; commit: string; real: Git; fake: Git } {
  const root = makeTempDir("recognizer-git-conformance-");

  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, "big.txt"), "x".repeat(100));
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");

  const commit = git(root, "rev-parse", "HEAD");
  const fake = new FakeGit(commit);

  fake.archives.set(commit, []);
  fake.texts.set(`${commit}:big.txt`, "x".repeat(100));

  return { root, commit, real: new GitAdapter(nodeIo()), fake };
}

describe("the fake and the adapter agree", () => {
  it("on an unknown commit and an oversized file", async () => {
    const { root, commit, real, fake } = both();
    const unknown = "0".repeat(40);
    const target = makeTempDir("recognizer-git-conformance-target-");

    for (const git of [real, fake]) {
      expect(git.nameStatus(root, commit, unknown)).toBeNull();
      expect(await git.showText(root, commit, "big.txt", 10)).toBeNull();
      expect(await git.showText(root, commit, "missing.txt", 1000)).toBeNull();
      expect(await git.showText(root, commit, "big.txt", 1000)).toBe(
        "x".repeat(100),
      );
      expect(await git.archive(root, unknown, [], target)).toBe(false);
    }
  });
});
