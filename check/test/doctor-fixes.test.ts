import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";
import { cachedScansState } from "../src/freshness.js";
import { isDirty } from "../src/scan-command.js";
import { fakeIo, ROOT, scanJson } from "./scan-helpers.js";

beforeEach(() => {
  vi.spyOn(process, "cwd").mockReturnValue(ROOT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const COMMIT = "abc123";
const CACHE = `${ROOT}/.recognizer/cache/scan.python.json`;
const CONFIG = `${ROOT}/.recognizer/config.yaml`;
const POLICY_FILE = `${ROOT}/.recognizer/policy.yaml`;

interface Setup {
  config?: string;
  policy?: string;
  cache?: string;
  status?: string;
}

function setup(options: Setup = {}) {
  return fakeIo({
    commit: COMMIT,
    status: options.status,
    files: {
      [`${ROOT}/m0.py`]: "",
      "/bin/recognizer-scan-python": "",
      ...(options.config === undefined ? {} : { [CONFIG]: options.config }),
      ...(options.policy === undefined
        ? {}
        : { [POLICY_FILE]: options.policy }),
      ...(options.cache === undefined ? {} : { [CACHE]: options.cache }),
    },
    env: { PATH: "/bin" },
  });
}

interface Problem {
  code: string;
  subject: string;
  line: string;
  fix: { text: string; command: string | null };
}

function problems(fake: ReturnType<typeof setup>, area: string): Problem[] {
  const before = fake.out().length;

  run(["doctor", "--json"], fake.io);

  return JSON.parse(fake.out().slice(before)).areas.find(
    (found: { name: string }) => found.name === area,
  ).problems;
}

function invalid(fake: ReturnType<typeof setup>): Problem[] {
  return problems(fake, "policy").filter(
    (problem) => problem.code === "policy-invalid",
  );
}

function words(command: string): string[] {
  return [...command.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((match) =>
    (match[1] ?? match[2] ?? "").replaceAll("'\\''", "'"),
  );
}

function apply(fake: ReturnType<typeof setup>, command: string | null) {
  const [, ...argv] = words(command as string);

  const status = run([...argv, "--repository", ROOT], fake.io);

  expect({ status, err: fake.err() }).toEqual({ status: 0, err: "" });
}

const current = scanJson(2, 1, { commit: COMMIT }, "  ");

describe("a dirty tree is named, not rescanned", () => {
  const dirty = (count: number) =>
    Array.from({ length: count }, (_, index) => ` M m${index}.py\n`).join("");

  it("gives the uncommitted-changes line and a text fix for one path", () => {
    const [problem] = problems(
      setup({
        policy: "components:\n  core:\n    - m*.py\n",
        cache: current,
        status: " M m0.py\n",
      }),
      "policy",
    ) as [Problem];

    expect(problem.code).toBe("scan-stale");
    expect(problem.line).toContain("uncommitted");
    expect(problem.line).toContain("(m0.py)");
    expect(problem.fix.command).toBeNull();
    expect(problem.fix.text).toContain("commit, ignore or stash");
    expect(problem.fix.text).toContain("recognizer scan");
  });

  it("names the first three of seven paths and counts the rest", () => {
    const [problem] = problems(
      setup({
        policy: "components:\n  core:\n    - m*.py\n",
        cache: current,
        status: dirty(7),
      }),
      "policy",
    ) as [Problem];

    expect(problem.line).toContain("7 uncommitted changes");
    expect(problem.line).toContain("(m0.py, m1.py, m2.py and 4 more)");
  });

  it("names exactly three paths with no more", () => {
    const [problem] = problems(
      setup({
        policy: "components:\n  core:\n    - m*.py\n",
        cache: current,
        status: dirty(3),
      }),
      "policy",
    ) as [Problem];

    expect(problem.line).toContain("(m0.py, m1.py, m2.py)");
    expect(problem.line).not.toContain("more");
  });

  it("keeps recognizer scan as the fix for a clean tree at another commit", () => {
    const [problem] = problems(
      setup({
        policy: "components:\n  core:\n    - m*.py\n",
        cache: scanJson(2, 1, { commit: "old" }, "  "),
      }),
      "policy",
    ) as [Problem];

    expect(problem.fix.command).toBe("recognizer scan");
    expect(problem.line).toContain("out of date with the working tree");
  });

  it("returns the reason for each stale state", () => {
    const base = { cache: current, policy: "" };

    expect(
      cachedScansState(
        setup({ ...base, status: " M a.py\n?? b.py\n" }).io,
        ROOT,
        ["python"],
      ),
    ).toEqual({
      state: "stale",
      reason: "uncommitted",
      paths: ["a.py", "b.py"],
    });
    expect(
      cachedScansState(
        setup({ cache: scanJson(2, 1, { commit: "old" }, "  ") }).io,
        ROOT,
        ["python"],
      ),
    ).toEqual({ state: "stale", reason: "scan" });
    expect(
      cachedScansState(
        fakeIo({ files: { [CACHE]: current, [`${ROOT}/m0.py`]: "" } }).io,
        ROOT,
        ["python"],
      ),
    ).toEqual({ state: "stale", reason: "scan" });
  });

  it("keeps isDirty a boolean over the same git call", () => {
    expect(isDirty(setup().io, ROOT)).toBe(false);
    expect(isDirty(setup({ status: " M a.py\n" }).io, ROOT)).toBe(true);
  });
});
