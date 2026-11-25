import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Limiter, type RepositoryStateHolder } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { GitAdapter } from "../src/adapters/git/git-adapter.js";
import { nodeIo } from "../src/cli.js";
import {
  WorkingTreeWatch,
  workingTreeFingerprint,
} from "../src/serve/working-tree-watch.js";
import { processScope } from "../src/stop-scope.js";

function git(root: string, ...args: string[]): void {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: root, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }
}

function committed(): string {
  const root = makeTempDir("working-tree-watch-");

  writeFileSync(join(root, "tracked.txt"), "one");
  git(root, "init", "-q");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "initial");

  return root;
}

function ports() {
  return {
    git: new GitAdapter(nodeIo(processScope)),
    limiter: new Limiter(2),
  };
}

function holderStub(): {
  holder: RepositoryStateHolder;
  fired: () => number;
  setActive: (value: boolean) => void;
} {
  let active = false;
  let count = 0;

  return {
    holder: {
      active: () => active,
      workingTreeChanged: () => {
        count += 1;
      },
    } as unknown as RepositoryStateHolder,
    fired: () => count,
    setActive: (value) => {
      active = value;
    },
  };
}

describe("working tree watch", () => {
  it("the_fingerprint_changes_when_a_file_joins_the_dirty_list", async () => {
    const root = committed();
    const clean = await workingTreeFingerprint(ports(), root);

    writeFileSync(join(root, "added.txt"), "x");

    expect(clean).toBe("");
    expect(await workingTreeFingerprint(ports(), root)).not.toBe(clean);
  });

  it("the_fingerprint_changes_when_an_already_dirty_file_is_edited_again", async () => {
    const root = committed();

    writeFileSync(join(root, "tracked.txt"), "two");

    const first = await workingTreeFingerprint(ports(), root);

    writeFileSync(join(root, "tracked.txt"), "three more");

    expect(await workingTreeFingerprint(ports(), root)).not.toBe(first);
  });

  it("the_fingerprint_is_equal_across_two_reads_with_nothing_between", async () => {
    const root = committed();

    writeFileSync(join(root, "tracked.txt"), "two");

    expect(await workingTreeFingerprint(ports(), root)).toBe(
      await workingTreeFingerprint(ports(), root),
    );
  });

  it("the_fingerprint_returns_to_clean_when_the_dirty_list_empties", async () => {
    const root = committed();

    writeFileSync(join(root, "tracked.txt"), "two");
    expect(await workingTreeFingerprint(ports(), root)).not.toBe("");

    writeFileSync(join(root, "tracked.txt"), "one");

    expect(await workingTreeFingerprint(ports(), root)).toBe("");
  });

  it("the_fingerprint_stamps_a_deleted_dirty_file_as_zero", async () => {
    const root = committed();

    rmSync(join(root, "tracked.txt"));

    expect(await workingTreeFingerprint(ports(), root)).toContain(
      "tracked.txt:0:0",
    );
  });

  it("a_run_ending_refreshes_the_holder", async () => {
    const root = committed();
    const { holder, fired, setActive } = holderStub();
    const watch = new WorkingTreeWatch(ports(), root, holder);

    await watch.tick();
    expect(fired()).toBe(0);

    setActive(true);
    await watch.tick();
    expect(fired()).toBe(0);

    setActive(false);
    await watch.tick();
    expect(fired()).toBe(1);

    await watch.tick();
    expect(fired()).toBe(1);
  });

  it("an_edit_fires_the_holder_once", async () => {
    const root = committed();
    const { holder, fired } = holderStub();
    const watch = new WorkingTreeWatch(ports(), root, holder);

    writeFileSync(join(root, "tracked.txt"), "two");
    await watch.tick();
    await watch.tick();

    expect(fired()).toBe(1);
  });

  it("a_non_git_folder_never_fires", async () => {
    const root = makeTempDir("working-tree-watch-plain-");
    const { holder, fired } = holderStub();
    const watch = new WorkingTreeWatch(ports(), root, holder);

    writeFileSync(join(root, "file.txt"), "x");
    await watch.tick();
    writeFileSync(join(root, "file.txt"), "xy");
    await watch.tick();

    expect(fired()).toBe(0);
  });
});
