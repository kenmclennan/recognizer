import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";
import { unsetValue } from "../src/config-edit.js";
import { loadKeys } from "../src/config-keys.js";
import { RETIRED_KEYS } from "../src/config-retired.js";
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
  for (const single of (command as string).split(" && ")) {
    const [, ...argv] = words(single);

    const status = run([...argv, "--repository", ROOT], fake.io);

    expect({ status, err: fake.err() }).toEqual({ status: 0, err: "" });
  }
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

describe("a retired key's fix leaves no empty section", () => {
  const published = loadKeys(fakeIo().io, ROOT);
  const sampleFor = (path: string[]) =>
    path.length === 1
      ? "overlays:\n  crap:\n    command: [x]\n"
      : `sensors:\n  structure:\n${
          path.length === 4
            ? `    warnings:\n      ${path[3]}: true\n`
            : `    ${path[2]}: 1\n`
        }`;

  it.each(RETIRED_KEYS.map((retired) => [retired.path.join(".")]))(
    "the printed fix for %s leaves a file of {}",
    (key) => {
      const fake = setup({ config: sampleFor(key.split(".")) });
      const [problem] = problems(fake, "config") as [Problem];

      expect(problem.code).toBe("config-retired");

      apply(fake, problem.fix.command);

      const after = fake.files.get(CONFIG) as string;

      expect(after.trim()).toBe("{}");
      expect(problems(fake, "config")).toEqual([]);
    },
  );

  it("keeps a sibling and its parents", () => {
    const text =
      "sensors:\n  structure:\n    warnings:\n      hub: true\n      cycle: true\n  crap:\n    threshold: 1\n";
    const outcome = unsetValue(
      text,
      published,
      "sensors.structure.warnings.hub",
    );

    expect((outcome as { text: string }).text).toBe(
      "sensors:\n  structure:\n    warnings:\n      cycle: true\n  crap:\n    threshold: 1\n",
    );
  });

  it("prunes a parent only once its last retired key is gone", () => {
    const fake = setup({
      config:
        "sensors:\n  structure:\n    hub_threshold: 1\n    instability_gap: 1\n",
    });

    const first = problems(fake, "config");

    expect(first).toHaveLength(2);

    apply(fake, (first[0] as Problem).fix.command);

    expect(fake.files.get(CONFIG)).toContain("structure:");

    const second = problems(fake, "config");

    expect(second).toHaveLength(1);

    apply(fake, (second[0] as Problem).fix.command);

    expect((fake.files.get(CONFIG) as string).trim()).toBe("{}");
    expect(problems(fake, "config")).toEqual([]);
  });

  it("no longer names the old message", () => {
    expect(RETIRED_KEYS[1]?.message).not.toContain(
      "delete the section it leaves empty",
    );
  });
});

describe("policy problems carry a recognizer policy command", () => {
  const folderScan = (...ids: string[]) =>
    scanJson(
      0,
      0,
      {
        commit: COMMIT,
        modules: ids.map((id) => ({
          id,
          language: "python",
          kind: "module",
          members: [],
        })),
      },
      "  ",
    );

  const scanned = folderScan("app/a.py");

  it("removes a glob matching nothing", () => {
    const policy =
      "components:\n  core:\n    - app/**\n  gone:\n    - gone/**\n";
    const fake = setup({ policy, cache: scanned });
    const found = problems(fake, "policy");

    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe("policy-entry");
    expect(found[0]?.fix.command).toBe(
      "recognizer policy --unset components.gone 'gone/**'",
    );
    expect(found[0]?.fix.text).toBe(found[0]?.fix.command);

    apply(fake, found[0]?.fix.command ?? null);

    expect(problems(fake, "policy")).toEqual([]);
  });

  it("reports a glob held by two components once, then for the other", () => {
    const policy =
      "components:\n  core:\n    - app/**\n  one:\n    - gone/**\n  two:\n    - gone/**\n";
    const fake = setup({ policy, cache: scanned });
    const first = problems(fake, "policy");

    expect(first).toHaveLength(1);
    expect(first[0]?.fix.command).toContain("components.one");

    apply(fake, first[0]?.fix.command ?? null);

    const second = problems(fake, "policy");

    expect(second).toHaveLength(1);
    expect(second[0]?.fix.command).toContain("components.two");
  });

  it("releases levels and uses before removing a component's last glob", () => {
    const policy =
      "components:\n  core:\n    - app/**\n  gone:\n    - gone/**\nlevels:\n  - core\n  - gone\nuses:\n  gone:\n    - core\n  core:\n    - gone\n";
    const fake = setup({ policy, cache: scanned });
    const found = problems(fake, "policy");

    expect(found).toHaveLength(1);
    expect(found[0]?.fix.command).toContain(" && ");

    apply(fake, found[0]?.fix.command ?? null);

    expect(problems(fake, "policy")).toEqual([]);
  });

  it("removes levels and uses entirely when only the gone component names them", () => {
    const policy =
      "components:\n  core:\n    - app/**\n  gone:\n    - gone/**\nlevels:\n  - gone\nuses:\n  gone:\n    - core\n";
    const fake = setup({ policy, cache: scanned });
    const found = problems(fake, "policy");

    apply(fake, found[0]?.fix.command ?? null);

    expect(problems(fake, "policy")).toEqual([]);
  });

  it("keeps a single command when the component has another glob", () => {
    const policy =
      "components:\n  core:\n    - app/**\n  gone:\n    - gone/**\n    - app/*\nlevels:\n  - gone\n";
    const fake = setup({ policy, cache: scanned });
    const found = problems(fake, "policy");

    expect(found[0]?.fix.command).not.toContain(" && ");

    apply(fake, found[0]?.fix.command ?? null);

    expect(problems(fake, "policy")).toEqual([]);
  });

  it("names both forms for an uncovered folder and each clears it", () => {
    const policy = "components:\n  core:\n    - other/**\n";
    const cache = folderScan("app/a.py", "other/b.py");
    const [problem] = problems(setup({ policy, cache }), "policy") as [Problem];

    expect(problem.code).toBe("policy-folder");
    expect(problem.fix.command).toBeNull();
    expect(problem.fix.text).toContain(
      "recognizer policy --add ignore 'app/*'",
    );
    expect(problem.fix.text).toContain(
      "recognizer policy --add components.<name> 'app/*'",
    );

    for (const command of [
      "recognizer policy --add ignore 'app/*'",
      "recognizer policy --add components.core 'app/*'",
    ]) {
      const fake = setup({ policy, cache });

      apply(fake, command);

      expect(problems(fake, "policy")).toEqual([]);
    }
  });

  it("says to name each root module for the root folder", () => {
    const [problem] = problems(
      setup({
        policy: "components:\n  core:\n    - other/**\n",
        cache: folderScan("root.py", "other/b.py"),
      }),
      "policy",
    ) as [Problem];

    expect(problem.fix.text).toContain("<module>");
    expect(problem.fix.text).toContain("name each root module");
  });

  const cases = [
    [
      "an unknown level",
      "components:\n  a:\n    - x/**\nlevels:\n  - a\n  - b\n",
      "recognizer policy --unset levels b",
    ],
    [
      "a duplicate level",
      "components:\n  a:\n    - x/**\nlevels:\n  - a\n  - a\n",
      "recognizer policy --unset levels a",
    ],
    [
      "an unknown uses section",
      "components:\n  a:\n    - x/**\nuses:\n  b:\n    - a\n",
      "recognizer policy --remove-section uses",
    ],
    [
      "an unknown uses target",
      "components:\n  a:\n    - x/**\nuses:\n  a:\n    - b\n",
      "recognizer policy --remove-section uses",
    ],
    [
      "an unknown uses section beside a valid one",
      "components:\n  a:\n    - x/**\nuses:\n  a:\n    - a\n  b:\n    - a\n",
      "recognizer policy --unset uses.b",
    ],
    [
      "an unknown uses target beside a valid one",
      "components:\n  a:\n    - x/**\nuses:\n  a:\n    - a\n    - b\n",
      "recognizer policy --unset uses.a b",
    ],
  ] as const;

  it.each(cases)("clears %s", (_, policy, command) => {
    const fake = setup({ policy });
    const found = invalid(fake);

    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe("policy-invalid");
    expect(found[0]?.fix.command).toBe(command);

    apply(fake, command);

    expect(invalid(fake)).toEqual([]);
  });

  it("clears only the message it names when a policy has two", () => {
    const policy =
      "components:\n  a:\n    - x/**\nlevels:\n  - a\n  - b\nuses:\n  c:\n    - a\n";
    const fake = setup({ policy });
    const found = invalid(fake);

    expect(found).toHaveLength(2);

    apply(fake, found[0]?.fix.command ?? null);

    expect(invalid(fake)).toHaveLength(1);
  });

  it("gives hand-edit text and no command for a structural fault", () => {
    const found = problems(
      setup({ policy: "components:\n  a:\n    - x/**\nwhat: 1\n" }),
      "policy",
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.fix.command).toBeNull();
    expect(found[0]?.fix.text).toContain("recognizer policy cannot repair");
    expect(found[0]?.fix.text).toContain(".recognizer/policy.yaml");
  });

  it("never names the policy file outside the structural case", () => {
    const fake = setup({
      policy:
        "components:\n  core:\n    - other/**\n  gone:\n    - gone/**\nlevels:\n  - core\n",
      cache: folderScan("app/a.py", "other/b.py"),
    });

    for (const problem of invalid(fake)) {
      expect(problem.fix.text).not.toContain("policy.yaml");
    }
  });
});

describe("config --list shows a registered empty section", () => {
  const list = (config: string, ...argv: string[]) => {
    const fake = setup({ config });

    return {
      status: run(["config", "--repository", ROOT, ...argv], fake.io),
      out: fake.out(),
      err: fake.err(),
    };
  };

  it("prints sensors.crap= for an empty map", () => {
    expect(list("sensors:\n  crap: {}\n", "--list").out).toBe(
      "sensors.crap=\n",
    );
  });

  it("prints a line for each empty section and none for the parent", () => {
    expect(list("sensors:\n  crap: {}\n  mutation: {}\n", "--list").out).toBe(
      "sensors.crap=\nsensors.mutation=\n",
    );
  });

  it("round-trips --add-section then --list", () => {
    const fake = setup({ config: "describer:\n  command: x\n" });

    run(
      ["config", "--repository", ROOT, "--add-section", "sensors.crap"],
      fake.io,
    );
    fake.io.stdout("");

    const listed = setup({ config: fake.files.get(CONFIG) as string });

    run(["config", "--repository", ROOT, "--list"], listed.io);

    expect(listed.out()).toContain("sensors.crap=\n");
  });

  it("still refuses --get of a section", () => {
    const result = list("sensors:\n  crap: {}\n", "--get", "sensors.crap");

    expect(result.status).toBe(2);
    expect(result.err).toContain("is a section, not a key");
  });
});
