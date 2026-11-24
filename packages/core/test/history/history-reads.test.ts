import { describe, expect, it } from "vitest";
import {
  type HistoryPorts,
  Limiter,
  listBranches,
  listHistory,
  listPullRequests,
  readChangeDetail,
  readRefFacts,
  readWorkingTree,
} from "../../src/index.js";
import { FakeForge } from "../fakes/fake-forge.js";
import { FakeGit } from "../fakes/fake-git.js";

const ROOT = "/repo";

function world(): { git: FakeGit; forge: FakeForge; ports: HistoryPorts } {
  const git = new FakeGit("c".repeat(40));
  const forge = new FakeForge();

  return { git, forge, ports: { git, forge, limiter: new Limiter(4) } };
}

function branched(): ReturnType<typeof world> {
  const made = world();

  made.git.defaultRefName = "origin/main";
  made.git.refs.set("feature", "f".repeat(40));
  made.git.mergeBases.set("origin/main...feature", "b".repeat(40));
  made.git.aheadBehinds.set("origin/main...feature", { behind: 1, ahead: 2 });
  made.git.refDiffs.set("origin/main...feature", [
    { status: "M", path: "a.py" },
    { status: "A", path: "c.py" },
  ]);

  return made;
}

describe("history reads", () => {
  it("list history passes the 200-commit limit to git, and an ok result with a detached head carries branch null", async () => {
    const { git, ports } = world();

    git.historyText = { ok: true, text: "\u001erecord" };
    git.branchName = null;

    expect(await listHistory(ports, ROOT)).toEqual({
      branch: null,
      text: "\u001erecord",
    });
    expect(git.calls).toContain("history 200");
  });

  it("list history reports a detached head with no branch", async () => {
    const { git, ports } = world();

    git.historyText = { ok: true, text: "x" };

    expect((await listHistory(ports, ROOT)).branch).toBeNull();

    git.branchName = "main";

    expect((await listHistory(ports, ROOT)).branch).toBe("main");
  });

  it("list history of a folder outside git is an error", async () => {
    const { git, ports } = world();

    git.inside = false;

    await expect(listHistory(ports, ROOT)).rejects.toThrow();
    await expect(listBranches(ports, ROOT)).rejects.toThrow();
  });

  it("list branches never reports a total below the listed count", async () => {
    const { git, ports } = world();

    git.branchesText = {
      ok: true,
      text: "a\u001f1\u001fx\u001f1\nb\u001f2\u001fx\u001f2\n",
    };
    git.branchTotal = 1;
    git.defaultRefName = "origin/main";

    expect(await listBranches(ports, ROOT)).toEqual({
      defaultRef: "origin/main",
      total: 2,
      text: git.branchesText.ok ? git.branchesText.text : "",
    });
    expect(git.calls).toContain("branches 100");
  });

  it("ref facts keep the changes at exactly the changes limit and drop them one over", async () => {
    const { ports } = branched();
    const refs = ["feature"];
    const entries = [
      { status: "M" as const, path: "a.py" },
      { status: "A" as const, path: "c.py" },
      { status: "A" as const, path: "d.py" },
    ];

    const { git } = branched();
    git.refDiffs.set("origin/main...feature", entries);

    const same = { ...ports, git };

    expect((await readRefFacts(same, ROOT, refs, 3))[0]?.changes).toHaveLength(
      3,
    );
    expect((await readRefFacts(same, ROOT, refs, 2))[0]?.changes).toBeNull();
    expect((await readRefFacts(same, ROOT, refs, 2))[0]?.ahead).toBe(2);
  });

  it("ref facts has no changes for a ref past the changes limit", async () => {
    const { ports } = branched();

    const within = (await readRefFacts(ports, ROOT, ["feature"], 2))[0];
    const past = (await readRefFacts(ports, ROOT, ["feature"], 1))[0];

    expect(within?.changes).toHaveLength(2);
    expect(past?.changes).toBeNull();
    expect(past?.ahead).toBe(2);
    expect(past?.mergeBase).toBe("b".repeat(40));
  });

  it("ref facts leaves an unresolved ref all null beside resolved ones", async () => {
    const { git, ports } = branched();

    git.refs.set("f".repeat(40), "f".repeat(40));
    git.mergeBases.set(`origin/main...${"f".repeat(40)}`, "b".repeat(40));
    git.aheadBehinds.set(`origin/main...${"f".repeat(40)}`, {
      behind: 1,
      ahead: 2,
    });
    git.refDiffs.set(`origin/main...${"f".repeat(40)}`, []);

    const facts = await readRefFacts(ports, ROOT, [
      "feature",
      "nope",
      "f".repeat(40),
    ]);

    expect(facts).toHaveLength(3);
    expect(facts[0]?.ahead).toBe(2);
    expect(facts[0]?.changes).not.toBeNull();
    expect(facts[1]).toEqual({
      ref: "nope",
      mergeBase: null,
      behind: null,
      ahead: null,
      changes: null,
    });
    expect(facts[2]?.ref).toBe("f".repeat(40));
    expect(facts[2]?.ahead).toBe(2);
  });

  it("ref facts keep a mixed request honest", async () => {
    const { ports } = branched();
    const facts = await readRefFacts(ports, ROOT, ["feature", "nope"]);

    expect(facts.map((fact) => fact.ref)).toEqual(["feature", "nope"]);
    expect(facts[0]?.ahead).toBe(2);
    expect(facts[1]?.ahead).toBeNull();
    expect(facts[1]?.changes).toBeNull();
  });

  it("ref facts are all null without a default ref", async () => {
    const { git, ports } = world();

    git.refs.set("main", "a".repeat(40));

    expect(await readRefFacts(ports, ROOT, ["main"])).toEqual([
      {
        ref: "main",
        mergeBase: null,
        behind: null,
        ahead: null,
        changes: null,
      },
    ]);
  });

  it("ref facts refuse option shaped refs before git runs", async () => {
    const { git, ports } = branched();
    const facts = await readRefFacts(ports, ROOT, ["--output=/tmp/f", "-x"]);

    expect(facts.every((fact) => fact.ahead === null)).toBe(true);
    expect(
      git.calls.filter((call) =>
        /^(mergeBase|aheadBehind|diffRefs)/.test(call),
      ),
    ).toEqual([]);
  });

  it("change detail commit refuses an option shaped ref before git runs", async () => {
    const { git, ports } = branched();

    await expect(
      readChangeDetail(ports, ROOT, "commit", "--output=/tmp/f"),
    ).rejects.toThrow("not a commit: --output=/tmp/f");
    await expect(readChangeDetail(ports, ROOT, "commit", "-x")).rejects.toThrow(
      "not a commit: -x",
    );
    expect(git.calls.filter((call) => call.startsWith("commitDetail"))).toEqual(
      [],
    );
  });

  it("change detail pr refuses a non numeric number", async () => {
    const { ports } = world();

    for (const bad of ["", "abc", "12;ls", "--web", "1234567890", "-1"]) {
      await expect(readChangeDetail(ports, ROOT, "pr", bad)).rejects.toThrow(
        `not a pull request number: ${bad}`,
      );
    }

    await expect(readChangeDetail(ports, ROOT, "other", "1")).rejects.toThrow(
      "unknown change kind: other",
    );
  });

  it("change detail pr returns the gh json", async () => {
    const { git, forge, ports } = branched();

    forge.result = {
      started: true,
      status: 0,
      stdout: '{"number":7}',
      stderr: "",
    };

    const detail = await readChangeDetail(ports, ROOT, "pr", "7");

    expect(detail.pull?.status).toBe("ok");
    expect(detail.pull?.text).toContain('"number":7');
    expect(detail.defaultRef).toBe("origin/main");
    expect(detail.git).toBeNull();
    expect(forge.calls[0]?.args.slice(0, 3)).toEqual(["pr", "view", "7"]);
    expect(git.calls.some((call) => call.startsWith("history"))).toBe(false);
  });

  it("change detail branch says missing when gh is absent", async () => {
    const { git, forge, ports } = branched();

    git.tipSummaries.set("feature", "A\u001f1\u001fedit a\n");
    forge.result = { started: false, status: null, stdout: "", stderr: "" };

    const detail = await readChangeDetail(ports, ROOT, "branch", "feature");

    expect(detail.pull?.status).toBe("missing");
    expect(detail.git).toBe("A\u001f1\u001fedit a\n");
    expect(detail.defaultRef).toBe("origin/main");
  });

  it("read pull requests returns gh json when gh succeeds", async () => {
    const { forge, ports } = world();

    forge.result = {
      started: true,
      status: 0,
      stdout: '[{"number":1}]',
      stderr: "",
    };

    const result = await listPullRequests(ports, ROOT);

    expect(result.status).toBe("ok");
    expect(result.text).toContain('"number":1');
    expect(forge.calls[0]?.timeoutMs).toBe(20_000);
  });

  it("read pull requests says missing when gh is not on the path", async () => {
    const { forge, ports } = world();

    forge.result = { started: false, status: null, stdout: "", stderr: "" };

    expect((await listPullRequests(ports, ROOT)).status).toBe("missing");
  });

  it("read pull requests says signed out for exit four naming gh auth login", async () => {
    const { forge, ports } = world();

    forge.result = {
      started: true,
      status: 4,
      stdout: "",
      stderr: "To get started, please run:  gh auth login\n",
    };

    expect(await listPullRequests(ports, ROOT)).toEqual({
      status: "signed-out",
      detail: "To get started, please run:  gh auth login",
      text: "",
    });
  });

  it("read pull requests says failed for exit four with other stderr", async () => {
    const { forge, ports } = world();

    forge.result = { started: true, status: 4, stdout: "", stderr: "other\n" };

    expect((await listPullRequests(ports, ROOT)).status).toBe("failed");
  });

  it("read pull requests says failed with the first stderr line", async () => {
    const { forge, ports } = world();

    forge.result = {
      started: true,
      status: 1,
      stdout: "",
      stderr: "boom\nmore\n",
    };

    const result = await listPullRequests(ports, ROOT);

    expect(result.status).toBe("failed");
    expect(result.detail).toBe("boom");
  });

  it("read pull requests names the failing command when stderr is empty", async () => {
    const { forge, ports } = world();

    forge.result = { started: true, status: 1, stdout: "", stderr: "" };

    expect((await listPullRequests(ports, ROOT)).detail).toBe(
      "gh pr list failed",
    );
  });

  it("read pull requests says gh did not answer on a timeout", async () => {
    const { forge, ports } = world();

    forge.result = {
      started: true,
      status: null,
      stdout: "",
      stderr: "",
      timedOut: true,
    };

    expect(await listPullRequests(ports, ROOT)).toEqual({
      status: "failed",
      detail: "gh did not answer within 20 seconds",
      text: "",
    });
  });

  it("read working tree returns the dirty entries git reports and none outside git", async () => {
    const { git, ports } = world();

    git.workingTreeEntries = [
      { code: " M", path: "test/a.test.ts" },
      { code: "??", path: "new.ts" },
    ];

    expect(await readWorkingTree(ports, ROOT)).toEqual({
      entries: [
        { code: " M", path: "test/a.test.ts" },
        { code: "??", path: "new.ts" },
      ],
    });

    git.inside = false;

    expect(await readWorkingTree(ports, ROOT)).toEqual({ entries: [] });
  });
});
