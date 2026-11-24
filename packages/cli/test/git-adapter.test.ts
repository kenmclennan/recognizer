import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { GitAdapter } from "../src/adapters/git/git-adapter.js";
import { parseNameStatus } from "../src/adapters/git/name-status-parse.js";
import { nodeIo } from "../src/cli.js";

function git(root: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(result.stderr);
  }

  return result.stdout.trim();
}

function repository(): { root: string; first: string; second: string } {
  const root = makeTempDir("recognizer-git-adapter-");

  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "Ada Lovelace");
  git(root, "config", "commit.gpgsign", "false");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/a.txt"), "one\ntwo\nthree\nfour\nfive\n");
  writeFileSync(join(root, "src/b.txt"), "keep\n");
  writeFileSync(join(root, "big.txt"), "x".repeat(2000));
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");

  const first = git(root, "rev-parse", "HEAD");

  git(root, "mv", "src/a.txt", "src/c.txt");
  writeFileSync(join(root, "src/b.txt"), "changed\n");
  writeFileSync(join(root, "src/new.txt"), "new\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "second");

  return { root, first, second: git(root, "rev-parse", "HEAD") };
}

describe("GitAdapter", () => {
  it("renamesSince reads one entry per renamed file", () => {
    const { root, first } = repository();

    expect(
      [...new GitAdapter(nodeIo()).renamesSince(root, first)].sort(),
    ).toEqual([["src/a.txt", "src/c.txt"]]);
  });

  it("nameStatus reads a rename as old then new path and the other letters", () => {
    const { root, first, second } = repository();
    const entries = new GitAdapter(nodeIo()).nameStatus(root, first, second);

    expect(entries).toEqual(
      expect.arrayContaining([
        { status: "R", path: "src/c.txt", from: "src/a.txt" },
        { status: "M", path: "src/b.txt" },
        { status: "A", path: "src/new.txt" },
      ]),
    );
    expect(entries).toHaveLength(3);
  });

  it("nameStatus gives null for an unknown commit and an option-shaped one", () => {
    const { root, first } = repository();
    const adapter = new GitAdapter(nodeIo());

    expect(adapter.nameStatus(root, first, "0".repeat(40))).toBeNull();
    expect(adapter.nameStatus(root, first, "--output=x")).toBeNull();
  });

  it("userName reads the configured name and gives null when unset", () => {
    const { root } = repository();
    const adapter = new GitAdapter(nodeIo());

    expect(adapter.userName(root)?.trim()).toBe("Ada Lovelace");

    git(root, "config", "--unset", "user.name");

    const outside = makeTempDir("recognizer-git-adapter-none-");
    const value = adapter.userName(outside);

    expect(value === null || typeof value === "string").toBe(true);
  });

  it("showText reads a file at a commit, and gives null over the limit or when absent", async () => {
    const { root, first, second } = repository();
    const adapter = new GitAdapter(nodeIo());

    expect(await adapter.showText(root, first, "src/a.txt", 1000)).toBe(
      "one\ntwo\nthree\nfour\nfive\n",
    );
    expect(await adapter.showText(root, second, "src/a.txt", 1000)).toBeNull();
    expect(await adapter.showText(root, first, "big.txt", 1000)).toBeNull();
    expect(
      await adapter.showText(root, "0".repeat(40), "big.txt", 5),
    ).toBeNull();
  });

  it("archive writes only the requested paths and gives false for an unknown commit", async () => {
    const { root, first } = repository();
    const adapter = new GitAdapter(nodeIo());
    const target = makeTempDir("recognizer-git-archive-");

    expect(await adapter.archive(root, first, ["src/b.txt"], target)).toBe(
      true,
    );
    expect(readFileSync(join(target, "src/b.txt"), "utf8")).toBe("keep\n");
    expect(existsSync(join(target, "src/a.txt"))).toBe(false);
    expect(existsSync(join(target, "big.txt"))).toBe(false);
    expect(existsSync(`${target}.tar`)).toBe(false);

    const whole = makeTempDir("recognizer-git-archive-whole-");

    expect(await adapter.archive(root, first, [], whole)).toBe(true);
    expect(existsSync(join(whole, "big.txt"))).toBe(true);

    expect(
      await adapter.archive(
        root,
        "0".repeat(40),
        [],
        makeTempDir("recognizer-x-"),
      ),
    ).toBe(false);
  });
});

describe("git optional locks", () => {
  const dumpEnv = ["-c", "alias.dumpenv=!env", "dumpenv"];

  it("run sets GIT_OPTIONAL_LOCKS=0 for git", () => {
    const { root } = repository();
    const result = nodeIo().run("git", ["-C", root, ...dumpEnv]);

    expect(result.stdout).toContain("GIT_OPTIONAL_LOCKS=0");
  });

  it("runAsync sets GIT_OPTIONAL_LOCKS=0 for git", async () => {
    const { root } = repository();
    const result = await nodeIo().runAsync("git", ["-C", root, ...dumpEnv])
      .result;

    expect(result.stdout).toContain("GIT_OPTIONAL_LOCKS=0");
  });

  it("a commit succeeds while the adapter's status read runs in a loop", async () => {
    const { root } = repository();
    const adapter = new GitAdapter(nodeIo());
    let reading = true;

    const reads = (async () => {
      while (reading) {
        adapter.dirty(root);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    })();

    for (let n = 0; n < 15; n++) {
      writeFileSync(join(root, "src/b.txt"), `edit ${n}\n`);
      git(root, "add", "src/b.txt");
      git(root, "commit", "-q", "-m", `edit ${n}`);
    }

    reading = false;
    await reads;

    expect(git(root, "log", "--format=%s", "-1")).toBe("edit 14");
  });
});

describe("parseNameStatus", () => {
  it("parses the measured -z output", () => {
    expect(parseNameStatus("D\0src/b.py\0A\0src/c.py\0")).toEqual([
      { status: "D", path: "src/b.py" },
      { status: "A", path: "src/c.py" },
    ]);
  });

  it("reads a rename", () => {
    expect(parseNameStatus("R100\0old\0new\0M\0a.py\0")).toEqual([
      { status: "R", path: "new", from: "old" },
      { status: "M", path: "a.py" },
    ]);
  });

  it("drops an unknown status letter", () => {
    expect(parseNameStatus("X\0x.py\0M\0y.py\0")).toEqual([
      { status: "M", path: "y.py" },
    ]);
  });

  it("reads an empty string as no changes", () => {
    expect(parseNameStatus("")).toEqual([]);
  });
});
