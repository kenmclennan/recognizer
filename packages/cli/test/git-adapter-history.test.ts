import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { GitAdapter } from "../src/adapters/git/git-adapter.js";
import { nodeIo } from "../src/cli.js";

const IDENTITY = [
  "-c",
  "user.name=T",
  "-c",
  "user.email=t@example.com",
  "-c",
  "commit.gpgsign=false",
];

function git(root: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...IDENTITY, ...args], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }

  return result.stdout.trim();
}

function commitFile(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
  git(root, "add", file);
  git(root, "commit", "-q", "-m", file);
}

function repository(): string {
  const root = makeTempDir("recognizer-history-");

  git(root, "init", "-q", "-b", "main");
  commitFile(root, "a.py", "1");
  commitFile(root, "b.py", "1");

  return root;
}

function withOriginHead(root: string): void {
  const head = git(root, "rev-parse", "main");

  git(root, "update-ref", "refs/remotes/origin/main", head);
  git(
    root,
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
  );
}

function branched(): string {
  const root = repository();

  withOriginHead(root);
  git(root, "checkout", "-q", "-b", "feature");
  commitFile(root, "c.py", "1");
  commitFile(root, "a.py", "2");
  git(root, "commit", "-q", "--amend", "-m", "edit a");
  git(root, "checkout", "-q", "main");
  commitFile(root, "d.py", "1");
  git(root, "update-ref", "refs/remotes/origin/main", "main");
  git(root, "tag", "v0.1.0", "main");

  return root;
}

const adapter = new GitAdapter(nodeIo());

async function historyText(root: string): Promise<string> {
  const result = await adapter.history(root, 200);

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.text;
}

describe("GitAdapter history", () => {
  it("list history returns one record per commit with the checked out branch", async () => {
    const root = branched();
    const text = await historyText(root);

    expect(adapter.branch(root)).toBe("main");
    expect(text.split("\u001e").length - 1).toBe(3);
    expect(text).toContain("v0.1.0");
    expect(text).toContain("d.py");
  });

  it("list history counts a merge commit against its first parent", async () => {
    const root = branched();

    git(root, "merge", "-q", "--no-ff", "-m", "merge feature", "feature");

    const merge = (await historyText(root)).split("\u001e")[1] as string;

    expect(merge).toContain("merge feature");
    expect(merge).toContain("A\tc.py");
    expect(merge).toContain("M\ta.py");
  });

  it("list branches names the default ref when origin head is set", async () => {
    const root = branched();
    const branches = await adapter.branches(root, 100);

    expect(adapter.defaultRef(root)).toBe("origin/main");
    expect(await adapter.branchCount(root)).toBe(2);
    expect(branches.ok && branches.text).toContain("feature\u001f");
    expect(branches.ok && branches.text).toContain("main\u001f");
  });

  it("list branches has no default ref without origin head", async () => {
    const root = repository();

    expect(adapter.defaultRef(root)).toBeNull();
    expect(await adapter.branchCount(root)).toBe(1);
  });

  it("ref facts returns ahead behind and the changed files against the default ref", async () => {
    const root = branched();
    const base = git(root, "merge-base", "main", "feature");

    expect(await adapter.mergeBase(root, "main", "feature")).toBe(base);
    expect(await adapter.aheadBehind(root, "main", "feature")).toEqual({
      behind: 1,
      ahead: 2,
    });
    expect(await adapter.diffRefs(root, "main", "feature")).toEqual([
      { status: "M", path: "a.py" },
      { status: "A", path: "c.py" },
    ]);
  });

  it("facts for reads a rename", async () => {
    const root = repository();

    withOriginHead(root);
    git(root, "checkout", "-q", "-b", "feature");
    git(root, "mv", "a.py", "renamed.py");
    git(root, "commit", "-q", "-m", "rename");

    expect(await adapter.diffRefs(root, "main", "feature")).toEqual([
      { status: "R", path: "renamed.py", from: "a.py" },
    ]);
  });

  it("list history reads a rename as a three field line", async () => {
    const root = repository();

    git(root, "mv", "a.py", "renamed.py");
    git(root, "commit", "-q", "-m", "rename");

    expect(await historyText(root)).toContain("R100\ta.py\trenamed.py");
  });

  it("history reads a rename with a similarity score below 100", async () => {
    const root = makeTempDir("recognizer-history-rename-");

    git(root, "init", "-q", "-b", "main");
    commitFile(
      root,
      "old.py",
      ["one", "two", "three", "four", "five", "six"].join("\n"),
    );
    git(root, "mv", "old.py", "new.py");
    writeFileSync(
      join(root, "new.py"),
      ["one", "two", "three", "four", "five", "6"].join("\n"),
    );
    git(root, "add", "new.py");
    git(root, "commit", "-q", "-m", "move and edit");

    const newest = (await historyText(root)).split("\u001e")[1] as string;
    const rows = newest.split("\n").filter((line) => /^R\d{3}\t/.test(line));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^R\d{3}\told\.py\tnew\.py$/);
    expect(rows[0]).not.toMatch(/^R100/);
  });

  it("list history returns a non ascii file name unescaped", async () => {
    const root = repository();

    commitFile(root, "é.py", "1");

    const text = await historyText(root);

    expect(text).toContain("A\té.py");
    expect(text).not.toContain("\\303");
  });

  it("history runs over the real committed history and reads a rename row", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = resolve(here, "../../..");
    const shallow = git(root, "rev-parse", "--is-shallow-repository");

    if (shallow !== "false") {
      return;
    }

    const records = (await historyText(root))
      .split("\u001e")
      .filter((record) => record.trim() !== "");
    const head = git(root, "rev-parse", "HEAD");
    const newest = records[0] as string;

    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records.length).toBeLessThanOrEqual(200);
    expect(newest.split("\u001f")[0]).toBe(head);

    for (const line of newest
      .split("\n")
      .slice(1)
      .filter((l) => l !== "")) {
      const fields = line.split("\t");
      const status = fields[0] as string;

      if (/^R\d+$/.test(status)) {
        expect(fields).toHaveLength(3);
      } else {
        expect(["A", "M", "D", "T"]).toContain(status);
        expect(fields).toHaveLength(2);
      }
    }
  });

  it("change detail commit returns author time and the full message", async () => {
    const root = repository();

    git(
      root,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "subject line",
      "-m",
      "body text",
    );

    const text = (await adapter.commitDetail(root, "HEAD")) as string;
    const [author, time, message] = text.split("\u001f");

    expect(author).toBe("T");
    expect(Number.isInteger(Number(time))).toBe(true);
    expect(message).toContain("subject line\n\nbody text");
  });

  it("change detail branch returns the tip and the default ref", async () => {
    const root = branched();

    expect(
      ((await adapter.tipSummary(root, "feature")) as string).endsWith(
        "\u001fedit a\n",
      ),
    ).toBe(true);
    expect(adapter.defaultRef(root)).toBe("origin/main");
  });

  it("change detail commit runs over the real committed history", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = resolve(here, "../../..");

    if (git(root, "rev-parse", "--is-shallow-repository") !== "false") {
      return;
    }

    const [author, time, message] = (
      (await adapter.commitDetail(root, "HEAD")) as string
    ).split("\u001f");

    expect(author).not.toBe("");
    expect(Number.isInteger(Number(time))).toBe(true);
    expect((message as string).trim()).not.toBe("");
  });
});

describe("GitAdapter state snapshot", () => {
  async function snapshot(root: string): Promise<string> {
    return (await adapter.stateSnapshot(root)) as string;
  }

  async function after(
    root: string,
    change: () => void,
  ): Promise<[string, string]> {
    const before = await snapshot(root);

    await new Promise((resolveWait) => setTimeout(resolveWait, 30));
    change();

    return [before, await snapshot(root)];
  }

  function worktree(root: string): string {
    const tree = join(makeTempDir("recognizer-history-tree-"), "tree");

    git(root, "worktree", "add", "-q", "-b", "wt", tree);

    return tree;
  }

  it("git state snapshot is equal across two reads with nothing between", async () => {
    const root = repository();

    expect(await snapshot(root)).toBe(await snapshot(root));
  });

  it("git state snapshot changes after a commit", async () => {
    const root = repository();
    const [before, next] = await after(root, () =>
      commitFile(root, "c.py", "1"),
    );

    expect(next).not.toBe(before);
  });

  it("git state snapshot changes after checkout dash b", async () => {
    const root = repository();
    const [before, next] = await after(root, () =>
      git(root, "checkout", "-q", "-b", "topic"),
    );

    expect(next).not.toBe(before);
  });

  it("git state snapshot changes after a fetch from a local bare remote", async () => {
    const root = repository();
    const remote = makeTempDir("recognizer-history-remote-");

    git(remote, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", remote);
    git(root, "push", "-q", "origin", "main");

    const [before, next] = await after(root, () =>
      git(root, "fetch", "-q", "origin"),
    );

    expect(next).not.toBe(before);
  });

  it("git state snapshot changes after pack refs removes the loose refs", async () => {
    const root = repository();
    const [before, next] = await after(root, () =>
      git(root, "pack-refs", "--all"),
    );

    expect(next).not.toBe(before);
  });

  it("git state snapshot is empty for a folder outside git", async () => {
    expect(
      await adapter.stateSnapshot(makeTempDir("recognizer-outside-")),
    ).toBeNull();
  });

  it("git state snapshot of a worktree changes after a commit inside it", async () => {
    const tree = worktree(repository());
    const [before, next] = await after(tree, () =>
      commitFile(tree, "w.py", "1"),
    );

    expect(next).not.toBe(before);
  });

  it("git state snapshot of a worktree changes after a checkout inside it", async () => {
    const tree = worktree(repository());
    const [before, next] = await after(tree, () =>
      git(tree, "checkout", "-q", "-b", "other"),
    );

    expect(next).not.toBe(before);
  });

  it("git state snapshot runs over the real repository", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = resolve(here, "../../..");
    const first = await snapshot(root);

    expect(first).not.toBe("");
    expect(await snapshot(root)).toBe(first);
  });
});

describe("GitAdapter working tree", () => {
  it("lists every dirty file with its status code and skips the recognizer folder", async () => {
    const root = repository();

    commitFile(root, "kept.ts", "k");
    commitFile(root, "test/math.test.ts", "a\n");
    writeFileSync(join(root, "test/math.test.ts"), "a\nb\n");
    writeFileSync(join(root, "fresh.ts"), "n");
    mkdirSync(join(root, ".recognizer/cache"), { recursive: true });
    writeFileSync(join(root, ".recognizer/cache/x.json"), "{}");

    const entries = [...((await adapter.workingTree(root)) ?? [])].sort(
      (a, b) => a.path.localeCompare(b.path),
    );

    expect(entries).toEqual([
      { code: "??", path: "fresh.ts" },
      { code: " M", path: "test/math.test.ts" },
    ]);
  });

  it("reads a staged rename as one entry and none from the old path", async () => {
    const root = repository();

    commitFile(root, "old-name.ts", "export const value = 1;\n".repeat(20));
    git(root, "mv", "old-name.ts", "new-name.ts");

    expect(await adapter.workingTree(root)).toEqual([
      { code: "R ", path: "new-name.ts" },
    ]);
  });

  it("is empty on a clean tree and null outside git", async () => {
    const root = repository();

    expect(await adapter.workingTree(root)).toEqual([]);
    expect(
      await adapter.workingTree(makeTempDir("recognizer-outside-")),
    ).toBeNull();
  });
});
