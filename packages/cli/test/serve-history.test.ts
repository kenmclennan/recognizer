import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { OPERATIONS } from "../src/serve/wire.js";
import { REPO } from "./helpers.js";
import {
  launcher,
  Serve,
  slowLaunchers,
  typescriptRepository,
} from "./serve-harness.js";

const TIMEOUT = scaledTimeout(120_000);

const TWELVE = [
  "history.list",
  "history.branches",
  "history.facts",
  "history.detail",
  "history.pulls",
  "changes.take",
  "changes.clear",
  "changes.adopt",
  "changes.poll",
  "git.begin",
  "git.poll",
  "git.end",
  "changes.worktree",
];

function git(root: string, ...args: string[]): void {
  const result = spawnSync(
    "git",
    [
      "-C",
      root,
      "-c",
      "user.email=t@example.com",
      "-c",
      "user.name=t",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
}

function repository(): string {
  const root = makeTempDir("serve-history-repo-");
  const text = "a = 1\n";

  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "a.py"), text);
  git(root, "add", "a.py");
  git(root, "commit", "-q", "-m", "first");
  mkdirSync(join(root, ".recognizer/cache"), { recursive: true });
  writeFileSync(
    join(root, ".recognizer/cache/scan.python.json"),
    JSON.stringify({
      files: [
        { path: "a.py", hash: createHash("sha256").update(text).digest("hex") },
      ],
      selection: {
        extensions: [".py"],
        skip_directory_names: [],
        skip_directory_prefixes: [],
        skip_directory_suffixes: [],
        skip_directories_containing: [],
        skip_file_globs: [],
      },
    }),
  );

  return root;
}

describe("serve history", () => {
  it("lists the twelve operations", () => {
    for (const name of TWELVE) {
      expect(OPERATIONS).toContain(name);
    }
  });

  it(
    "replies to every operation and keeps two windows on one repository apart",
    async () => {
      const serve = new Serve("/nonexistent-launchers");
      const root = repository();

      try {
        const listed = await serve.call("history.list", { repository: root });

        expect(listed.ok.branch).toBe("main");
        expect(listed.ok.text).toContain("first");

        const branches = await serve.call("history.branches", {
          repository: root,
        });

        expect(branches.ok.total).toBe(1);

        const facts = await serve.call("history.facts", {
          repository: root,
          refs: ["main"],
        });

        expect(facts.ok).toHaveLength(1);

        const detail = await serve.call("history.detail", {
          repository: root,
          kind: "commit",
          reference: "HEAD",
        });

        expect(detail.ok.git).toContain("first");

        const refused = await serve.call("history.detail", {
          repository: root,
          kind: "pr",
          reference: "x",
        });

        expect(refused.error).toBe("not a pull request number: x");

        const pulls = await serve.call("history.pulls", { repository: root });

        expect(["ok", "missing", "signed-out", "failed"]).toContain(
          pulls.ok.status,
        );

        await serve.call("changes.take", { repository: root, window: "w-1" });

        const adopted = await serve.call("changes.adopt", {
          repository: root,
          window: "w-1",
        });

        expect(adopted.ok.branch).toBe("main");
        expect(adopted.ok.commit).toHaveLength(7);

        writeFileSync(join(root, "a.py"), "a = 2\n");

        const first = await serve.call("changes.poll", {
          repository: root,
          window: "w-1",
        });

        expect(first.ok.changed).toBe(true);
        expect(first.ok.changes.files).toEqual([
          { path: "a.py", kind: "modified" },
        ]);

        const other = await serve.call("changes.poll", {
          repository: root,
          window: "w-2",
        });

        expect(other.ok).toEqual({ changed: false });

        const again = await serve.call("changes.poll", {
          repository: root,
          window: "w-1",
        });

        expect(again.ok).toEqual({ changed: false });

        const cleared = await serve.call("changes.clear", {
          repository: root,
          window: "w-1",
          closed: true,
        });

        expect(cleared.ok).toBeNull();
        expect(
          (
            await serve.call("changes.poll", {
              repository: root,
              window: "w-1",
            })
          ).ok,
        ).toEqual({ changed: false });

        await serve.call("git.begin", { repository: root, window: "w-1" });

        expect(
          (await serve.call("git.poll", { repository: root, window: "w-1" }))
            .ok,
        ).toEqual({ changed: false });

        expect(
          (await serve.call("git.end", { repository: root, window: "w-1" })).ok,
        ).toBeNull();

        expect(
          (await serve.call("changes.worktree", { repository: root })).ok,
        ).toEqual({ entries: [{ code: " M", path: "a.py" }] });
      } finally {
        await serve.close();
      }
    },
    TIMEOUT,
  );

  it(
    "answers history.pulls and history.list while historical scans hold every scan slot",
    async () => {
      const gate = makeTempDir("serve-history-gate-");
      const launchers = slowLaunchers(gate);

      launcher(launchers, "gh", "echo '[]'");

      const root = typescriptRepository();
      const commits: string[] = [];

      git(root, "init", "-q", "-b", "main");

      for (let n = 0; n < 6; n += 1) {
        writeFileSync(join(root, `extra-${n}.ts`), `export const n = ${n};\n`);
        git(root, "add", "-A");
        git(root, "commit", "-q", "-m", `commit ${n}`);

        const rev = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
          encoding: "utf8",
        });

        commits.push(rev.stdout.trim());
      }

      const serve = new Serve(launchers);
      const slots = Math.max(1, Math.min(4, availableParallelism()));

      try {
        const slow = commits.map((commit) =>
          serve.send("view.scans", { repository: root, commit }),
        );

        await serve.until(() =>
          readdirSync(gate).filter((name) => name.endsWith(".pid")).length >=
          slots
            ? true
            : undefined,
        );

        const pulls = await serve.call("history.pulls", { repository: root });
        const listed = await serve.call("history.list", { repository: root });

        expect(pulls.ok).toEqual({ status: "ok", detail: "", text: "[]\n" });
        expect(listed.ok.branch).toBe("main");
        expect(
          serve.lines.filter((line) => slow.includes(line.id as number)),
        ).toEqual([]);
      } finally {
        writeFileSync(join(gate, "release"), "");
        await serve.close();
      }
    },
    TIMEOUT,
  );

  it(
    "answers history.pulls and history.list while an opening scan runs a slow scanner",
    async () => {
      const gate = makeTempDir("serve-history-opening-gate-");
      const launchers = slowLaunchers(gate);

      launcher(launchers, "gh", "echo '[]'");

      const root = typescriptRepository();

      git(root, "init", "-q", "-b", "main");
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", "first");

      const serve = new Serve(launchers);

      try {
        serve.send("scan.start", {
          repository: root,
          describe: false,
          analysis: true,
          sense: [],
        });

        await serve.until(() =>
          readdirSync(gate).filter((name) => name.endsWith(".pid")).length > 0
            ? true
            : undefined,
        );

        const pulls = await serve.call("history.pulls", { repository: root });
        const listed = await serve.call("history.list", { repository: root });

        expect(pulls.ok).toEqual({ status: "ok", detail: "", text: "[]\n" });
        expect(listed.ok.branch).toBe("main");
        expect(serve.lines.filter((line) => "outcome" in line)).toEqual([]);
      } finally {
        writeFileSync(join(gate, "release"), "");
        await serve.close();
      }
    },
    TIMEOUT,
  );

  it(
    "answers history.pulls and history.list while a scan holds the service's own thread in a synchronous plugin call",
    async () => {
      const gate = makeTempDir("serve-history-blocking-gate-");
      const launchers = makeTempDir("serve-history-blocking-launchers-");

      launcher(
        launchers,
        "recognizer-scan-typescript",
        [
          `case "$1" in`,
          `manifest|check)`,
          `  echo $$ >> ${gate}/blocked.pid`,
          `  while [ ! -e ${gate}/release ]; do sleep 0.1; done`,
          `  exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@";;`,
          `*) exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@";;`,
          `esac`,
        ].join("\n"),
      );
      launcher(launchers, "gh", "echo '[]'");

      const root = typescriptRepository();

      git(root, "init", "-q", "-b", "main");
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", "first");

      const serve = new Serve(launchers);

      try {
        serve.send("scan.start", {
          repository: root,
          describe: false,
          analysis: true,
          sense: [],
        });

        await serve.until(() =>
          existsSync(join(gate, "blocked.pid")) ? true : undefined,
        );

        const pulls = await serve.call("history.pulls", { repository: root });
        const listed = await serve.call("history.list", { repository: root });

        expect(pulls.ok).toEqual({ status: "ok", detail: "", text: "[]\n" });
        expect(listed.ok.branch).toBe("main");
        expect(serve.lines.filter((line) => "outcome" in line)).toEqual([]);
      } finally {
        writeFileSync(join(gate, "release"), "");
        await serve.close();
      }
    },
    TIMEOUT,
  );
});
