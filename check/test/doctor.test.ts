import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";
import { unsetValue } from "../src/config-edit.js";
import { loadKeys } from "../src/config-keys.js";
import { RETIRED_KEYS } from "../src/config-retired.js";
import { cachedScansState } from "../src/freshness.js";
import { fakeIo, PYTHON, ROOT, scanJson } from "./scan-helpers.js";

beforeEach(() => {
  vi.spyOn(process, "cwd").mockReturnValue(ROOT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const COMMIT = "abc123";
const CACHE = `${ROOT}/.recognizer/cache/scan.python.json`;
const BREW = "brew install --cask kenmclennan/tap/recognizer";
const READY_SENSOR =
  "sensors:\n  mine:\n    command: [recognizer-sensors, mine]\n";
const POLICY = 'components:\n  core: "m*.py"\n';

interface Setup {
  config?: string | null;
  policy?: string | null;
  cache?: string | null;
  status?: string;
  scanner?: boolean;
  env?: Record<string, string>;
  files?: Record<string, string>;
  gap?: boolean;
}

function setup(options: Setup = {}) {
  const files: Record<string, string> = {
    [`${ROOT}/m0.py`]: "",
    ...(options.config === null || options.config === undefined
      ? {}
      : { [`${ROOT}/.recognizer/config.yaml`]: options.config }),
    ...(options.policy === null || options.policy === undefined
      ? {}
      : { [`${ROOT}/.recognizer/policy.yaml`]: options.policy }),
    ...(options.cache === null || options.cache === undefined
      ? {}
      : { [CACHE]: options.cache }),
    ...(options.scanner === false ? {} : { "/bin/recognizer-scan-python": "" }),
    ...options.files,
  };

  return fakeIo({
    commit: COMMIT,
    status: options.status,
    files,
    env: { PATH: "/usr/local/bin:/bin", ...options.env },
    sensorsPreflight: options.gap
      ? {
          run: () => ({
            stdout: `${JSON.stringify({ gaps: [{ code: "no-coverage", suite: null, line: "mine has no coverage" }] })}\n`,
          }),
        }
      : undefined,
  });
}

function doctor(fake: ReturnType<typeof setup>, ...args: string[]) {
  const status = run(["doctor", ...args], fake.io);

  return { status, out: fake.out(), err: fake.err() };
}

function json(fake: ReturnType<typeof setup>, ...args: string[]) {
  const result = doctor(fake, ...args, "--json");

  return { ...result, report: JSON.parse(result.out) };
}

const current = scanJson(2, 1, { commit: COMMIT }, "  ");
const clean = {
  config: READY_SENSOR,
  policy: POLICY,
  cache: current,
  env: { PATH: "/bin" },
};

function codes(report: {
  areas: { name: string; problems: { code: string }[] }[];
}) {
  return report.areas.flatMap((area) =>
    area.problems.map((problem) => `${area.name}:${problem.code}`),
  );
}

describe("doctor: a clean repository", () => {
  it("prints No problems last and exits 0", () => {
    const result = doctor(setup(clean), ROOT);

    expect(result.status).toBe(0);
    expect(result.out.trimEnd().split("\n").pop()).toBe("No problems");
  });

  it("gives the whole clean --json document", () => {
    const result = json(setup(clean), ROOT);

    expect(result.status).toBe(0);
    expect(result.report).toEqual({
      repository: ROOT,
      ok: true,
      problems: 0,
      areas: [
        { name: "config", skipped: null, problems: [] },
        { name: "policy", skipped: null, problems: [] },
        { name: "scanners", skipped: null, problems: [] },
        { name: "sensors", skipped: null, problems: [] },
      ],
    });
    expect(result.out).toBe(`${JSON.stringify(result.report, null, 2)}\n`);
  });

  it("checks a repository with no config, no policy and no sensors", () => {
    const result = doctor(setup({ env: { PATH: "/bin" } }), ROOT);

    expect(result.status).toBe(0);
    expect(result.out).toBe("No problems\n");
  });
});

describe("doctor: config", () => {
  const RETIRED = "sensors:\n  structure:\n    distance_threshold: 0.5\n";

  it("reports a retired key with its --unset fix, as one problem", () => {
    const result = json(setup({ config: RETIRED, env: { PATH: "/bin" } }));

    expect(result.status).toBe(1);
    expect(result.report).toEqual({
      repository: ROOT,
      ok: false,
      problems: 1,
      areas: [
        {
          name: "config",
          skipped: null,
          problems: [
            {
              code: "config-retired",
              subject: "sensors.structure.distance_threshold",
              line: expect.stringContaining(
                "config/sensors/structure/distance_threshold was removed",
              ),
              fix: {
                text: "recognizer config --unset sensors.structure.distance_threshold",
                command:
                  "recognizer config --unset sensors.structure.distance_threshold",
              },
            },
          ],
        },
        { name: "policy", skipped: null, problems: [] },
        { name: "scanners", skipped: null, problems: [] },
        { name: "sensors", skipped: null, problems: [] },
      ],
    });
  });

  it("prints the problem count and the fix under the line", () => {
    const result = doctor(setup({ config: RETIRED, env: { PATH: "/bin" } }));

    expect(result.status).toBe(1);
    expect(result.out).toMatch(
      /^config\n {2}config\/sensors\/structure\/distance_threshold was removed[^\n]*\n {4}fix: recognizer config --unset sensors\.structure\.distance_threshold\n1 problem\n$/,
    );
  });

  it("reports all ten retired keys", () => {
    const text = [
      "overlays: {}",
      "sensors:",
      "  structure:",
      "    distance_threshold: 1",
      "    hub_threshold: 1",
      "    instability_gap: 1",
      "    composition_roots: []",
      "    warnings:",
      "      stable_abstractions: true",
      "      hub: true",
      "      stable_dependencies: true",
      "      folder_cycle: true",
      "      policy_drift: true",
      "",
    ].join("\n");
    const result = json(setup({ config: text, env: { PATH: "/bin" } }));
    const found = result.report.areas[0].problems;

    expect(found.map((problem: { code: string }) => problem.code)).toEqual(
      Array(10).fill("config-retired"),
    );
    expect(
      found.map((problem: { subject: string }) => problem.subject),
    ).toEqual(RETIRED_KEYS.map((retired) => retired.path.join(".")));
    expect(result.report.problems).toBe(10);
  });

  it("reports an empty sensor section with --remove-section", () => {
    const result = json(
      setup({ config: "sensors:\n  crap:\n", env: { PATH: "/bin" } }),
    );

    expect(result.report.areas[0].problems).toEqual([
      {
        code: "config-empty",
        subject: "sensors.crap",
        line: "config sensors.crap is empty: delete the section or give it settings",
        fix: {
          text: "recognizer config --remove-section sensors.crap",
          command: "recognizer config --remove-section sensors.crap",
        },
      },
    ]);
  });

  it("gives a text fix for an empty section that is not a sensor", () => {
    const result = json(setup({ config: "tests:\n", env: { PATH: "/bin" } }));
    const [problem] = result.report.areas[0].problems;

    expect(problem.code).toBe("config-empty");
    expect(problem.fix.command).toBeNull();
  });

  it("reports a duplicate suite name", () => {
    const suite = (name: string) =>
      `  - name: ${name}\n    language: python\n    directory: .\n    command: pytest\n    coverage:\n      path: c.lcov\n      format: lcov\n`;
    const result = json(
      setup({
        config: `tests:\n${suite("unit")}${suite("unit")}`,
        env: { PATH: "/bin" },
      }),
    );

    expect(codes(result.report)).toEqual(["config:config-duplicate-suite"]);
    expect(result.report.areas[0].problems[0].subject).toBe("unit");
    expect(result.report.areas[0].problems[0].fix.command).toBeNull();
  });

  it("reports a schema fault as config-invalid", () => {
    const result = json(
      setup({
        config: "sensors:\n  crap:\n    threshold: -1\n",
        env: { PATH: "/bin" },
      }),
    );

    expect(codes(result.report)).toContain("config:config-invalid");
    expect(result.report.areas[0].problems[0].fix.command).toBeNull();
  });

  it("reports unparseable YAML and skips the sensors", () => {
    const result = json(setup({ config: "a: [\n", env: { PATH: "/bin" } }));

    expect(codes(result.report)).toEqual(["config:config-yaml"]);

    const text = doctor(setup({ config: "a: [\n", env: { PATH: "/bin" } }));

    expect(text.out.endsWith("1 problem\n")).toBe(true);
  });

  it("reports faults of different codes together", () => {
    const result = json(
      setup({
        config:
          "sensors:\n  crap:\n  structure:\n    hub_threshold: 2\n    warnings:\n      cycle: maybe\n",
        env: { PATH: "/bin" },
      }),
    );

    expect([...new Set(codes(result.report))]).toEqual([
      "config:config-retired",
      "config:config-empty",
      "config:config-invalid",
    ]);
  });

  it("never reports a fault twice", () => {
    const result = json(
      setup({
        config: "sensors:\n  structure:\n    hub_threshold: 2\n",
        env: { PATH: "/bin" },
      }),
    );

    expect(codes(result.report)).toEqual(["config:config-retired"]);
  });
});

describe("retired keys are unsettable", () => {
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
    "unsets %s and doctor then reports none",
    (key) => {
      const path = key.split(".");
      const text = sampleFor(path);

      const outcome = unsetValue(text, published, key);

      expect(outcome.status).toBe("ok");

      const after = (outcome as { text: string }).text;

      expect(after).not.toMatch(path[path.length - 1] as string);

      const result = json(setup({ config: after, env: { PATH: "/bin" } }));

      expect(codes(result.report)).not.toContain("config:config-retired");
    },
  );

  it("reports a retired key not in the document as absent", () => {
    expect(
      unsetValue(
        "sensors:\n  crap:\n    threshold: 1\n",
        published,
        "overlays",
      ),
    ).toEqual({ status: "absent" });
    expect(
      unsetValue(
        "sensors:\n  structure:\n    warnings:\n      cycle: true\n",
        published,
        "sensors.structure.hub_threshold",
      ),
    ).toEqual({ status: "absent" });
  });

  it("still refuses an unknown key", () => {
    expect(
      unsetValue(
        "sensors:\n  crap:\n",
        published,
        "sensors.structure.nonsense",
      ),
    ).toMatchObject({ status: "refused" });
  });
});

describe("doctor: policy", () => {
  it("reports an invalid policy and makes no scan comparison", () => {
    const result = json(
      setup({ ...clean, policy: "unknown_thing: 1\n", cache: null }),
    );

    expect(codes(result.report)).toEqual(["policy:policy-invalid"]);
  });

  it("reports an unparseable policy", () => {
    const result = json(setup({ ...clean, policy: "a: [\n", cache: null }));

    expect(codes(result.report)).toEqual(["policy:policy-invalid"]);
  });

  it("reports a folder no component covers", () => {
    const cache = scanJson(
      0,
      0,
      {
        commit: COMMIT,
        modules: [
          { id: "m0.py", language: "python", kind: "module", members: [] },
          { id: "sub/x.py", language: "python", kind: "module", members: [] },
        ],
      },
      "  ",
    );
    const result = json(
      setup({ ...clean, policy: 'components:\n  core: "m0.py"\n', cache }),
    );
    const [problem] = result.report.areas[1].problems;

    expect(problem).toMatchObject({
      code: "policy-folder",
      subject: "sub",
    });
    expect(problem.fix.command).toBeNull();
    expect(problem.fix.text).toContain(".recognizer/policy.yaml");
  });

  it("reports an entry matching no module", () => {
    const result = json(
      setup({
        ...clean,
        policy: 'components:\n  core: "m*.py"\n  ghost: "nothing/*.py"\n',
      }),
    );

    expect(result.report.areas[1].problems).toMatchObject([
      { code: "policy-entry", subject: "nothing/*.py" },
    ]);
  });

  it("reports a missing scan with the scan fix and starts no scan", () => {
    const fake = setup({ ...clean, cache: null });
    const result = json(fake);

    expect(result.status).toBe(1);
    expect(result.report.areas[1].problems).toEqual([
      {
        code: "scan-missing",
        subject: "python",
        line: expect.stringContaining("no scan"),
        fix: { text: "recognizer scan", command: "recognizer scan" },
      },
    ]);
    expect(fake.calls.some((call) => call.command === PYTHON)).toBe(false);
  });

  it("reports a scan whose file hash differs from the file on disk", () => {
    const cache = scanJson(
      2,
      1,
      {
        commit: COMMIT,
        files: [{ path: "m0.py", hash: "0".repeat(64) }],
      },
      "  ",
    );
    const result = json(setup({ ...clean, cache }));

    expect(codes(result.report)).toEqual(["policy:scan-stale"]);
  });

  it("reports a scan taken at another commit as stale", () => {
    const cache = scanJson(2, 1, { commit: "other" }, "  ");

    expect(codes(json(setup({ ...clean, cache })).report)).toEqual([
      "policy:scan-stale",
    ]);
  });

  it("reports a dirty tree as a stale scan", () => {
    expect(
      codes(json(setup({ ...clean, status: " M m0.py\n" })).report),
    ).toEqual(["policy:scan-stale"]);
  });

  it("says nothing of the policy when there is no policy file, even with no scan", () => {
    const result = json(setup({ ...clean, policy: null, cache: null }));

    expect(codes(result.report)).toEqual([]);
  });

  it("makes no comparison for a policy with no components", () => {
    const result = json(
      setup({ ...clean, policy: "ignore: []\n", cache: null }),
    );

    expect(codes(result.report)).toEqual([]);
  });
});

describe("doctor: scanners", () => {
  it("reports a language with no scanner on PATH", () => {
    const result = json(setup({ ...clean, scanner: false }));

    expect(result.report.areas[2].problems).toEqual([
      {
        code: "scanner-missing",
        subject: "python",
        line: expect.stringContaining("recognizer-scan-python"),
        fix: { text: BREW, command: BREW },
      },
    ]);
  });

  it("accepts a scanner present in a PATH directory", () => {
    const result = json(
      setup({
        ...clean,
        scanner: false,
        env: { PATH: "/opt/tools:/bin" },
        files: { "/opt/tools/recognizer-scan-python": "" },
      }),
    );

    expect(result.report.areas[2].problems).toEqual([]);
  });

  it("reports a relative override", () => {
    const result = json(
      setup({ ...clean, env: { PATH: "/bin", RECOGNIZER_SCAN_PYTHON: "py" } }),
    );

    expect(result.report.areas[2].problems).toMatchObject([
      { code: "scanner-override", subject: "python" },
    ]);
  });

  it("accepts an absolute override that exists and reports one that does not", () => {
    const present = json(
      setup({
        ...clean,
        scanner: false,
        env: { PATH: "/none", RECOGNIZER_SCAN_PYTHON: "/x/scan" },
        files: { "/x/scan": "" },
      }),
    );
    const absent = json(
      setup({
        ...clean,
        scanner: false,
        env: { PATH: "/bin", RECOGNIZER_SCAN_PYTHON: "/y/scan" },
      }),
    );

    expect(present.report.areas[2].problems).toEqual([]);
    expect(codes(absent.report)).toEqual(["scanners:scanner-missing"]);
  });

  it("checks nothing for a repository with no language", () => {
    const fake = fakeIo({ commit: COMMIT, env: { PATH: "/none" } });
    const result = json(fake);

    expect(result.report.areas[2].problems).toEqual([]);
  });
});

describe("doctor: fix commands name the repository only when it was named", () => {
  it("adds --repository to a config fix and the scan positional", () => {
    const named = json(
      setup({
        config: "sensors:\n  structure:\n    hub_threshold: 1\n",
        policy: POLICY,
        cache: null,
        env: { PATH: "/bin" },
      }),
      ROOT,
    );

    expect(named.report.areas[0].problems[0].fix.command).toBe(
      `recognizer config --unset sensors.structure.hub_threshold --repository ${ROOT}`,
    );
    expect(named.report.areas[1].problems[0].fix.command).toBe(
      `recognizer scan ${ROOT}`,
    );
  });

  it("quotes a path that holds a space", () => {
    const folder = "/my repo";
    const fake = fakeIo({
      commit: COMMIT,
      env: { PATH: "/bin" },
      files: {
        [`${folder}/.recognizer/config.yaml`]:
          "sensors:\n  structure:\n    hub_threshold: 1\n",
      },
    });
    const result = json(fake, folder);

    expect(result.report.areas[0].problems[0].fix.command).toBe(
      "recognizer config --unset sensors.structure.hub_threshold --repository '/my repo'",
    );
  });
});

describe("doctor: usage", () => {
  it.each([
    [["doctor", "a", "b"]],
    [["doctor", "--bogus"]],
    [["doctor", "/nowhere"]],
  ])("%j exits 2", (argv) => {
    const fake = setup(clean);

    expect(run(argv, fake.io)).toBe(2);
  });
});

describe("cachedScansState", () => {
  it("is current for a cache at the current commit with a clean tree", () => {
    const fake = setup({ ...clean });

    expect(cachedScansState(fake.io, ROOT, ["python"])).toMatchObject({
      state: "current",
    });
  });

  it("is missing when a language has no cache", () => {
    const fake = setup({ ...clean, cache: null });

    expect(cachedScansState(fake.io, ROOT, ["python"])).toEqual({
      state: "missing",
    });
  });

  it("is stale when the commit differs", () => {
    const fake = setup({
      ...clean,
      cache: scanJson(2, 1, { commit: "old" }, "  "),
    });

    expect(cachedScansState(fake.io, ROOT, ["python"])).toEqual({
      state: "stale",
    });
  });
});
