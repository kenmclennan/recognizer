import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Git } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { FakeGit } from "../../core/test/fakes/fake-git.js";
import { GitAdapter } from "../src/adapters/git/git-adapter.js";
import { nodeIo } from "../src/cli.js";
import { FakeIo } from "./support/fake-io.js";
import { archiveTarProgram, FakeRepositories } from "./support/git-program.js";
import type { FakeFiles } from "./support/io/files.js";

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

  it("on the branch, work tree and default ref", () => {
    const { root, commit, real, fake } = both();
    const outside = makeTempDir("recognizer-git-conformance-outside-");
    const seeded = fake as FakeGit;

    seeded.branchName = "main";

    expect(real.branch(root)).toBe("main");
    expect(seeded.branch()).toBe("main");
    expect(real.insideWorkTree(root)).toBe(true);
    expect(seeded.insideWorkTree()).toBe(true);
    expect(real.defaultRef(root)).toBeNull();
    expect(seeded.defaultRef()).toBeNull();
    expect(real.insideWorkTree(outside)).toBe(false);

    seeded.inside = false;

    expect(seeded.insideWorkTree()).toBe(false);
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

const LINES = Array.from({ length: 20 }, (_, index) => `line ${index}\n`).join(
  "",
);

function history() {
  const root = makeTempDir("recognizer-git-history-");
  const work = "/work";
  const io = new FakeIo();
  const repositories = new FakeRepositories(io.files);

  io.install("git", repositories.program());
  io.install("tar", archiveTarProgram);

  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  git(root, "config", "commit.gpgsign", "false");

  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
    io.files.writeFile(`${work}/${path}`, text);
  };
  const remove = (path: string) => {
    rmSync(join(root, path));
    io.files.remove(`${work}/${path}`);
  };
  const commit = (message: string): { real: string; fake: string } => {
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", message);

    return {
      real: git(root, "rev-parse", "HEAD"),
      fake: repositories.commitAll(work, message),
    };
  };

  write("src/a.txt", LINES);
  write("src/b.txt", `${LINES}b\n`);

  const first = commit("first");

  write("src/c.txt", "c\n");
  write("src/a.txt", `${LINES}edited\n`);

  const second = commit("second");

  remove("src/b.txt");
  write("src/d.txt", `${LINES}b\nrenamed\n`);

  const third = commit("third");

  git(root, "checkout", "-q", "-b", "other", first.real);
  repositories.checkout(work, "other", first.fake);
  write("src/e.txt", "e\n");

  const other = commit("other");

  git(root, "checkout", "-q", "main");
  repositories.checkout(work, "main");

  return {
    root,
    work,
    real: new GitAdapter(nodeIo()),
    fake: new GitAdapter(io),
    io,
    first,
    second,
    third,
    other,
  };
}

function filesUnder(directory: string, prefix = ""): Record<string, string> {
  const found: Record<string, string> = {};

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      Object.assign(
        found,
        filesUnder(join(directory, entry.name), `${prefix}${entry.name}/`),
      );
    } else {
      found[`${prefix}${entry.name}`] = readFileSync(
        join(directory, entry.name),
        "utf8",
      );
    }
  }

  return found;
}

describe("the fake git program and the adapter agree over history", () => {
  it("on resolving refs and ancestry", async () => {
    const h = history();

    expect(h.real.resolveRef(h.root, "HEAD")).toBe(h.third.real);
    expect(h.fake.resolveRef(h.work, "HEAD")).toBe(h.third.fake);

    for (const [side, root, shas] of [
      [h.real, h.root, h.second.real],
      [h.fake, h.work, h.second.fake],
    ] as const) {
      expect(side.resolveRef(root, shas)).toBe(shas);
      expect(side.resolveRef(root, shas.slice(0, 8))).toBe(shas);
      expect(side.resolveRef(root, "other")).not.toBeNull();
      expect(side.resolveRef(root, "nope")).toBeNull();
      expect(side.resolveRef(root, "0".repeat(40))).toBeNull();
      expect(side.commit(root)).not.toBeNull();
      expect(side.userName(root)?.trim()).toBe("t");
      expect(side.branch(root)).toBe("main");
    }

    for (const [side, root, a, b] of [
      [h.real, h.root, h.first.real, h.third.real],
      [h.fake, h.work, h.first.fake, h.third.fake],
    ] as const) {
      expect(side.isAncestor(root, a, b)).toBe(true);
      expect(side.isAncestor(root, b, a)).toBe(false);
    }
  });

  it("on the merge base, ahead and behind and the diffs across a branch", async () => {
    const h = history();

    expect(await h.real.mergeBase(h.root, "main", "other")).toBe(h.first.real);
    expect(await h.fake.mergeBase(h.work, "main", "other")).toBe(h.first.fake);

    for (const [side, root] of [
      [h.real, h.root],
      [h.fake, h.work],
    ] as const) {
      expect(await side.aheadBehind(root, "main", "other")).toEqual({
        behind: 2,
        ahead: 1,
      });
      expect(await side.diffRefs(root, "main", "other")).toEqual([
        { status: "A", path: "src/e.txt" },
      ]);
      expect(await side.mergeBase(root, "main", "nope")).toBeNull();
      expect(await side.aheadBehind(root, "main", "nope")).toBeNull();
    }
  });

  it("on added, modified and renamed files between commits", () => {
    const h = history();
    const seen = [
      [h.real, h.root, h.first.real, h.second.real, h.third.real],
      [h.fake, h.work, h.first.fake, h.second.fake, h.third.fake],
    ] as const;
    const results = seen.map(([side, root, first, second, third]) => [
      side.nameStatus(root, first, second),
      side.nameStatus(root, second, third),
      side.nameStatus(root, first, third),
      [...side.renamesSince(root, second)],
      [...side.renamesSince(root, third)],
    ]);

    expect(results[1]).toEqual(results[0]);
    expect(results[0]?.[0]).toEqual([
      { status: "M", path: "src/a.txt" },
      { status: "A", path: "src/c.txt" },
    ]);
    expect(results[0]?.[1]).toEqual([
      { status: "R", path: "src/d.txt", from: "src/b.txt" },
    ]);
    expect(results[0]?.[3]).toEqual([["src/b.txt", "src/d.txt"]]);
    expect(results[0]?.[4]).toEqual([]);
  });

  it("on file texts at a commit and an unknown path", async () => {
    const h = history();

    for (const [side, root, first, third] of [
      [h.real, h.root, h.first.real, h.third.real],
      [h.fake, h.work, h.first.fake, h.third.fake],
    ] as const) {
      expect(await side.showText(root, first, "src/b.txt", 1000)).toBe(
        `${LINES}b\n`,
      );
      expect(await side.showText(root, third, "src/b.txt", 1000)).toBeNull();
      expect(await side.showText(root, third, "src/d.txt", 1000)).toBe(
        `${LINES}b\nrenamed\n`,
      );
    }
  });

  it("on archiving a commit whole and by path", async () => {
    const h = history();
    const extracted: Record<string, string>[] = [];

    for (const [side, root, commit, paths] of [
      [h.real, h.root, h.second.real, []],
      [h.real, h.root, h.second.real, ["src/a.txt"]],
      [h.real, h.root, h.second.real, ["missing.txt"]],
    ] as const) {
      const target = makeTempDir("recognizer-git-history-archive-");
      const archived = await side.archive(root, commit, paths, target);

      extracted.push(archived ? filesUnder(target) : { failed: "" });
    }

    for (const [paths, index] of [
      [[], 0],
      [["src/a.txt"], 1],
      [["missing.txt"], 2],
    ] as const) {
      const target = h.io.files.makeTempDir();
      const archived = await h.fake.archive(
        h.work,
        h.second.fake,
        paths,
        target,
      );
      const found: Record<string, string> = archived
        ? Object.fromEntries(
            [...walkFake(h.io.files, target, "")].map((path) => [
              path,
              h.io.files.readFile(`${target}/${path}`),
            ]),
          )
        : { failed: "" };

      expect(found).toEqual(extracted[index]);
    }
  });
});

function* walkFake(
  files: FakeFiles,
  directory: string,
  prefix: string,
): Generator<string> {
  for (const entry of files.readDir(directory)) {
    if (entry.kind === "directory") {
      yield* walkFake(
        files,
        `${directory}/${entry.name}`,
        `${prefix}${entry.name}/`,
      );
    } else {
      yield `${prefix}${entry.name}`;
    }
  }
}
