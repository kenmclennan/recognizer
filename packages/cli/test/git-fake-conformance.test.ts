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

  it("on the branch, work tree, file list and default ref", () => {
    const { root, commit, real, fake } = both();
    const outside = makeTempDir("recognizer-git-conformance-outside-");
    const seeded = fake as FakeGit;

    seeded.branchName = "main";
    seeded.files = ["big.txt"];

    expect(real.branch(root)).toBe("main");
    expect(seeded.branch()).toBe("main");
    expect(real.insideWorkTree(root)).toBe(true);
    expect(seeded.insideWorkTree()).toBe(true);
    expect(real.listFiles(root)).toEqual(seeded.listFiles());
    expect(real.defaultRef(root)).toBeNull();
    expect(seeded.defaultRef()).toBeNull();
    expect(real.insideWorkTree(outside)).toBe(false);
    expect(real.listFiles(outside)).toBeNull();

    seeded.inside = false;

    expect(seeded.insideWorkTree()).toBe(false);
    expect(seeded.listFiles()).toBeNull();
    expect(commit).not.toBe("");
  });

  it("on the merge base, ahead and behind and the ref diff", async () => {
    const { root, real, fake } = both();

    git(root, "checkout", "-q", "-b", "topic");
    writeFileSync(join(root, "new.txt"), "n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "second");

    const topic = git(root, "rev-parse", "topic");
    const seeded = fake as FakeGit;

    seeded.mergeBases.set("main...topic", git(root, "rev-parse", "main"));
    seeded.aheadBehinds.set("main...topic", { behind: 0, ahead: 1 });
    seeded.refDiffs.set("main...topic", [{ status: "A", path: "new.txt" }]);

    for (const one of [real, fake]) {
      expect(await one.mergeBase(root, "main", "topic")).toBe(
        git(root, "rev-parse", "main"),
      );
      expect(await one.aheadBehind(root, "main", "topic")).toEqual({
        behind: 0,
        ahead: 1,
      });
      expect(await one.diffRefs(root, "main", "topic")).toEqual([
        { status: "A", path: "new.txt" },
      ]);
      expect(await one.mergeBase(root, "main", "nope")).toBeNull();
      expect(await one.aheadBehind(root, "main", "nope")).toBeNull();
      expect(await one.diffRefs(root, "main", "nope")).toBeNull();
      expect(await one.diffRefs(root, "--output=x", "topic")).toBeNull();
    }

    expect(topic).not.toBe("");
  });

  it("on the working tree inside and outside git", async () => {
    const { root, real, fake } = both();
    const outside = makeTempDir("recognizer-git-conformance-wt-outside-");
    const seeded = fake as FakeGit;

    expect(await real.workingTree(root)).toEqual([]);
    expect(await seeded.workingTree()).toEqual([]);

    writeFileSync(join(root, "fresh.txt"), "n");
    seeded.workingTreeEntries = [{ code: "??", path: "fresh.txt" }];

    expect(await real.workingTree(root)).toEqual(await seeded.workingTree());
    expect(await real.workingTree(outside)).toBeNull();

    seeded.inside = false;

    expect(await seeded.workingTree()).toBeNull();
  });

  it("on the state snapshot inside and outside git", async () => {
    const { root, real, fake } = both();
    const outside = makeTempDir("recognizer-git-conformance-outside-");
    const seeded = fake as FakeGit;
    const first = await real.stateSnapshot(root);

    expect(await real.stateSnapshot(root)).toBe(first);
    expect(await seeded.stateSnapshot()).toBe(await seeded.stateSnapshot());

    seeded.state = "state-1";
    writeFileSync(join(root, "more.txt"), "m");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "more");

    expect(await real.stateSnapshot(root)).not.toBe(first);
    expect(await seeded.stateSnapshot()).not.toBe("state-0");
    expect(await real.stateSnapshot(outside)).toBeNull();

    seeded.inside = false;

    expect(await seeded.stateSnapshot()).toBeNull();
  });
});
