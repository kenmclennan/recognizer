import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";
import { unsetValue } from "../src/config-edit.js";
import { loadKeys } from "../src/config-keys.js";
import { RETIRED_KEYS } from "../src/config-retired.js";
import { cachedScansState } from "../src/freshness.js";
import { REPO } from "./helpers.js";
import {
  describerManifestText,
  fakeIo,
  PYTHON,
  ROOT,
  scanJson,
} from "./scan-helpers.js";

beforeEach(() => {
  vi.spyOn(process, "cwd").mockReturnValue(ROOT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const COMMIT = "abc123";
const CACHE = `${ROOT}/.recognizer/cache/scan.python.json`;
const READY_SENSOR =
  "sensors:\n  crap:\n    command: [recognizer-sense-crap, run]\n";
const POLICY = 'components:\n  core: "m*.py"\n';

interface Setup {
  config?: string | null;
  policy?: string | null;
  cache?: string | null;
  status?: string;
  scanner?: boolean;
  onPath?: string[];
  env?: Record<string, string>;
  files?: Record<string, string>;
  gap?: boolean;
  shippedDescriber?: boolean;
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
    ...options.files,
  };

  return fakeIo({
    commit: COMMIT,
    status: options.status,
    files,
    env: options.env ?? {},
    scanners: options.scanner === false ? {} : { [PYTHON]: {} },
    onPath:
      options.onPath ??
      (options.config?.includes("recognizer-sense-crap")
        ? ["recognizer-sense-crap"]
        : []),
    sensorManifests: true,
    ...(options.shippedDescriber
      ? {
          programs: {
            "recognizer-describe-claude": (args: string[]) =>
              args[0] === "manifest"
                ? { stdout: describerManifestText("prompt-0123456789ab") }
                : { stdout: "" },
          },
        }
      : {}),
    sensorsPreflight: options.gap
      ? {
          run: () => ({
            stdout: `${JSON.stringify({ gaps: [{ code: "no-coverage", suite: null, line: "crap has no coverage" }] })}\n`,
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
      warnings: 0,
      areas: [
        { name: "config", skipped: null, problems: [] },
        { name: "policy", skipped: null, problems: [] },
        { name: "scanners", skipped: null, problems: [] },
        { name: "sensors", skipped: null, problems: [] },
        { name: "describers", skipped: null, problems: [] },
      ],
    });
    expect(result.out).toBe(`${JSON.stringify(result.report, null, 2)}\n`);
  });

  it("checks a repository with no config, no policy and no sensors", () => {
    const result = doctor(setup(), ROOT);

    expect(result.status).toBe(0);
    expect(result.out).toBe("No problems\n");
  });
});

describe("doctor: config", () => {
  const RETIRED = "sensors:\n  structure:\n    distance_threshold: 0.5\n";

  it("reports a retired key with its --unset fix, as one problem", () => {
    const result = json(setup({ config: RETIRED }));

    expect(result.status).toBe(1);
    expect(result.report).toEqual({
      repository: ROOT,
      ok: false,
      problems: 1,
      warnings: 0,
      areas: [
        {
          name: "config",
          skipped: null,
          problems: [
            {
              severity: "problem",
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
        { name: "describers", skipped: null, problems: [] },
      ],
    });
  });

  it("prints the problem count and the fix under the line", () => {
    const result = doctor(setup({ config: RETIRED }));

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
    const result = json(setup({ config: text }));
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
    const result = json(setup({ config: "sensors:\n  crap:\n" }));

    expect(result.report.areas[0].problems).toEqual([
      {
        severity: "problem",
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
    const result = json(setup({ config: "tests:\n" }));
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
      }),
    );

    expect(codes(result.report)).toContain("config:config-invalid");
    expect(result.report.areas[0].problems[0].fix.command).toBeNull();
    expect(result.report.areas[3].skipped).toBe("config has problems");
  });

  it("reports unparseable YAML and skips the sensors", () => {
    const result = json(setup({ config: "a: [\n" }));

    expect(codes(result.report)).toEqual(["config:config-yaml"]);
    expect(result.report.areas[3].skipped).toBe("config has problems");

    const text = doctor(setup({ config: "a: [\n" }));

    expect(text.out).toContain("sensors not checked: config has problems");
    expect(text.out.endsWith("1 problem\n")).toBe(true);
  });

  it("reports faults of different codes together", () => {
    const result = json(
      setup({
        config:
          "sensors:\n  crap:\n  structure:\n    hub_threshold: 2\n    warnings:\n      cycle: maybe\n",
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

      const result = json(setup({ config: after }));

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
    expect(problem.fix.text).toContain(
      "recognizer policy --add ignore 'sub/*'",
    );
    expect(problem.fix.text).not.toContain("policy.yaml");
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
        severity: "problem",
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
    const result = json(setup({ ...clean, status: " M m0.py\n" }));
    const [problem] = result.report.areas[1].problems;

    expect(codes(result.report)).toEqual(["policy:scan-stale"]);
    expect(problem.line).toContain("uncommitted");
    expect(problem.fix.command).toBeNull();
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
  it("reports a language no installed scanner claims", () => {
    const result = json(
      setup({ ...clean, scanner: false, env: { PATH: "/opt" } }),
    );

    expect(result.report.areas[2].problems).toEqual([
      {
        severity: "problem",
        code: "scanner-missing",
        subject: "scanners",
        line: "no scanner is installed",
        fix: {
          text: "install a scanner that claims a language: recognizer plugins lists what is installed",
          command: null,
        },
      },
    ]);
  });

  it("accepts a language one installed scanner claims", () => {
    const result = json(setup(clean));

    expect(result.report.areas[2].problems).toEqual([]);
  });

  it("reports a config entry naming a scanner that is not installed", () => {
    const result = json(
      setup({
        ...clean,
        config: `${READY_SENSOR}scanners:\n  python: gone\n`,
      }),
    );

    expect(result.report.areas[2].problems).toMatchObject([
      {
        code: "scanner-missing",
        subject: "python",
        fix: { text: "install recognizer-scan-gone" },
      },
    ]);
  });

  it("checks nothing for a repository with no language", () => {
    const fake = fakeIo({ commit: COMMIT, scanners: { [PYTHON]: {} } });
    const result = json(fake);

    expect(result.report.areas[2].problems).toEqual([]);
  });
});

describe("doctor: sensors", () => {
  it("reports a gap with its own line and the help fix", () => {
    const fake = setup({ ...clean, gap: true });
    const result = json(fake);

    expect(result.report.areas[3].problems).toEqual([
      {
        severity: "problem",
        code: "sensor-gap",
        subject: "crap",
        line: "crap has no coverage",
        fix: {
          text: "recognizer help sensors crap",
          command: "recognizer help sensors crap",
        },
      },
    ]);
    expect(
      fake.calls
        .filter((call) => call.command.startsWith("recognizer-sense-"))
        .every(
          (call) =>
            ["check", "manifest"].includes(call.args[0] ?? "") &&
            !call.args.includes("--run"),
        ),
    ).toBe(true);
  });

  it("gives the recorded install line as the plugin-missing fix", () => {
    const fake = setup({
      ...clean,
      onPath: [],
      config: `${READY_SENSOR}install:\n  recognizer-sense-crap: get crap\n`,
    });
    const result = json(fake);

    expect(result.report.areas[3].problems).toMatchObject([
      {
        code: "plugin-missing",
        subject: "crap",
        fix: { text: "get crap", command: null },
      },
    ]);
  });

  it("gives the instruction when no install line is recorded", () => {
    const result = json(setup({ ...clean, onPath: [] }));

    expect(result.report.areas[3].problems[0].fix.text).toBe(
      "install recognizer-sense-crap: no install line is recorded for it, run recognizer plugin add crap on a machine that has it",
    );
  });

  it("gives no problem for a registered command that is not recognizer-sensors", () => {
    const result = json(
      setup({
        ...clean,
        config: "sensors:\n  mine:\n    command: [my-tool]\n",
      }),
    );

    expect(result.status).toBe(0);
    expect(result.report.areas[3].problems).toEqual([]);
  });

  it("gives no problem for a sensor set off", () => {
    const fake = setup({ ...clean, config: "sensors:\n  structure: off\n" });

    expect(json(fake).status).toBe(0);
    expect(
      fake.calls.some((call) => call.command.startsWith("recognizer-sense-")),
    ).toBe(false);
  });
});

describe("doctor: fix commands name the repository only when it was named", () => {
  it("adds --repository to a config fix and the scan positional", () => {
    const named = json(
      setup({
        config: "sensors:\n  structure:\n    hub_threshold: 1\n",
        policy: POLICY,
        cache: null,
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

describe("doctor starts nothing costly and writes nothing", () => {
  const failing = {
    config: `${READY_SENSOR}  other:\n    command: [other-tool, --run]\n  structure:\n    hub_threshold: 1\ntests:\n  - name: unit\n    language: python\n    directory: .\n    command: pytest-should-not-run\n    coverage:\n      path: c.lcov\n      format: lcov\n`,
    policy: 'components:\n  core: "m0.py"\n',
    cache: null,
    scanner: false,
    gap: true,
  };

  it("runs only git, manifest and check, launches nothing, and leaves the files as they were", () => {
    const fake = setup(failing);
    const before = new Map(fake.files);
    const result = json(fake);

    expect(result.status).toBe(1);
    expect(codes(result.report).length).toBeGreaterThanOrEqual(3);
    expect(fake.calls.length).toBeGreaterThan(0);

    for (const call of fake.calls) {
      expect(
        call.command === "git" || call.command.startsWith("recognizer-sense-"),
      ).toBe(true);

      if (call.command.startsWith("recognizer-sense-")) {
        expect(["check", "manifest"]).toContain(call.args[0]);
        expect(call.args).not.toContain("--run");
      }
    }

    expect(
      fake.calls.some((call) => call.command.startsWith("recognizer-scan")),
    ).toBe(false);
    expect(
      fake.calls.some((call) => /describe|pytest/.test(call.command)),
    ).toBe(false);
    expect(fake.launches).toEqual([]);
    expect(fake.writes).toEqual([]);
    expect(fake.removed).toEqual([]);
    expect(fake.renames).toEqual([]);
    expect(fake.files).toEqual(before);
  });

  it("never runs a registered non-shipped sensor", () => {
    const fake = setup({
      ...clean,
      config: "sensors:\n  other:\n    command: [other-tool, --run]\n",
    });

    json(fake);

    expect(fake.calls.length).toBeGreaterThan(0);
    expect(fake.calls.every((call) => call.command === "git")).toBe(true);
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
      reason: "scan",
    });
  });
});

describe("real content", () => {
  const empty = (name: string) => {
    const fake = fakeIo({
      commit: COMMIT,
      files: {
        [`${ROOT}/.recognizer/config.yaml`]: readFileSync(name, "utf8"),
      },
    });

    return JSON.parse((run(["doctor", "--json"], fake.io), fake.out()));
  };
  const invalid = join(REPO, "schema/config-examples/invalid");

  it("finds no config problem in the committed .recognizer/config.yaml", () => {
    expect(
      empty(join(REPO, ".recognizer/config.yaml")).areas[0].problems,
    ).toEqual([]);
  });

  it.each(
    readdirSync(invalid).filter(
      (name) =>
        name.startsWith("sensors-retired-") || name === "overlays-retired.yaml",
    ),
  )("%s gives exactly one config-retired problem", (name) => {
    const [first, ...rest] = empty(join(invalid, name)).areas[0].problems;

    expect(rest).toEqual([]);
    expect(first.code).toBe("config-retired");
  });

  it("gives bad-yaml.yaml one config-yaml problem", () => {
    expect(
      empty(join(invalid, "bad-yaml.yaml")).areas[0].problems.map(
        (problem: { code: string }) => problem.code,
      ),
    ).toEqual(["config-yaml"]);
  });

  it("parses the committed fixtures/check policy with no policy-invalid problem", () => {
    const fake = fakeIo({
      commit: COMMIT,
      files: {
        [`${ROOT}/.recognizer/policy.yaml`]: readFileSync(
          join(REPO, "fixtures/check/.recognizer/policy.yaml"),
          "utf8",
        ),
      },
    });

    run(["doctor", "--json"], fake.io);

    expect(
      JSON.parse(fake.out()).areas[1].problems.map(
        (problem: { code: string }) => problem.code,
      ),
    ).not.toContain("policy-invalid");
  });
});

describe("doctor: unregistered shipped plugins", () => {
  const ALL = [
    "recognizer-sense-crap",
    "recognizer-sense-mutation",
    "recognizer-sense-thresholds",
  ];
  const CRAP = "sensors:\n  crap: {}\n";

  it("reports each installed shipped plugin that is not registered as a problem, with its fix", () => {
    const result = json(
      setup({
        config: CRAP,
        onPath: ALL,
        shippedDescriber: true,
      }),
      ROOT,
    );
    const problems = result.report.areas.flatMap(
      (area: { problems: { code: string; fix: unknown; line: string }[] }) =>
        area.problems,
    );

    expect(result.status).toBe(1);
    expect(result.report).toMatchObject({
      ok: false,
      problems: 3,
      warnings: 0,
    });
    expect(
      problems.map((one: { fix: { command: string } }) => one.fix.command),
    ).toEqual([
      "recognizer plugin add mutation",
      "recognizer plugin add thresholds",
      "recognizer plugin add claude",
    ]);
    expect(
      problems.every(
        (one: { code: string }) => one.code === "unregistered-plugin",
      ),
    ).toBe(true);
  });

  it("prints the problem lines and the problem count, and exits 1", () => {
    const result = doctor(
      setup({ config: CRAP, onPath: ALL, shippedDescriber: true }),
      ROOT,
    );
    const lines = result.out.trimEnd().split("\n");

    expect(result.status).toBe(1);
    expect(lines.at(-1)).toBe("3 problems");
    expect(result.out).toContain(
      "  mutation is not registered in .recognizer/config.yaml; register it with `recognizer plugin add mutation`.\n    fix: recognizer plugin add mutation\n",
    );
  });

  it("reports nothing when every installed plugin is registered", () => {
    const result = doctor(
      setup({
        config:
          "sensors:\n  crap: {}\n  mutation: {}\n  thresholds: {}\ndescriber:\n  command: [describer]\n  version: v1\n",
        onPath: ALL,
        shippedDescriber: true,
      }),
      ROOT,
    );

    expect(result.status).toBe(0);
    expect(result.out).toContain("No problems");
    expect(result.out).not.toContain("unregistered");
  });

  it("reports nothing for an invalid config and skips both areas", () => {
    const result = json(
      setup({
        config: "sensors:\n  crap:\n    bogus: 1\n",
        onPath: ALL,
        shippedDescriber: true,
      }),
      ROOT,
    );
    const area = (name: string) =>
      result.report.areas.find((one: { name: string }) => one.name === name);

    expect(codes(result.report)).not.toContain("sensors:unregistered-plugin");
    expect(area("sensors").skipped).not.toBeNull();
    expect(area("describers").skipped).not.toBeNull();
  });

  it("reports each installed plugin as a problem with no config file", () => {
    const result = json(setup({ onPath: ALL, shippedDescriber: true }), ROOT);

    expect(codes(result.report)).toEqual([
      "sensors:unregistered-plugin",
      "sensors:unregistered-plugin",
      "sensors:unregistered-plugin",
      "describers:unregistered-plugin",
    ]);
    expect(result.status).toBe(1);
  });

  it("reports nothing when the plugins are not installed", () => {
    const result = json(setup({ onPath: [] }), ROOT);

    expect(codes(result.report)).toEqual([]);
  });
});
