import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildChanges as build,
  commandRefusal,
  type SetupChoices,
  type Survey,
} from "../../src/index.js";

const REPO = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

const survey = JSON.parse(
  readFileSync(
    join(REPO, "schema/setup-survey-examples/valid/loom.json"),
    "utf8",
  ),
) as Survey;

function buildChanges(from: Survey, choices: SetupChoices) {
  return build(from, choices, "claude");
}

const all: SetupChoices = {
  analysis: { on: true, limits: { pair_min_lines: 12, long_function: 30 } },
  plugins: ["crap", "mutation"],
  runners: [
    { name: "engine" },
    { name: "app", env: { NODE_ENV: "test" } },
    { name: "tauri" },
  ],
  tools: ["@vitest/coverage-v8", "cargo-llvm-cov"],
  policy: [
    { kind: "ignore", globs: ["scripts/*"], why: "w", based_on: "b" },
    {
      kind: "entry",
      paths: ["app/src/main.ts"],
      why: "w",
      based_on: "b",
    },
    {
      kind: "forbid",
      from: ["engine/**"],
      to: ["app/**"],
      both: false,
      why: "w",
      based_on: "b",
      today: { count: 2, example: "engine/a.ts -> app/b.ts" },
    },
  ],
};

function titles(choices: SetupChoices, from: Survey = survey): string[] {
  return buildChanges(from, choices).changes.map((change) => change.id);
}

function toolInstalled(name: string): Survey {
  return {
    ...survey,
    tools: survey.tools.map((tool) =>
      tool.name === name ? { ...tool, installed: true } : tool,
    ),
  };
}

describe("buildChanges", () => {
  it("gives the mock's order", () => {
    expect(titles(all)).toEqual([
      "analysis-long_function",
      "analysis-pair_min_lines",
      "plugin-crap",
      "plugin-mutation",
      "tool-@vitest/coverage-v8",
      "tool-cargo-llvm-cov",
      "tests-engine",
      "tests-app",
      "tests-tauri",
      "policy-1",
      "policy-2",
      "policy-3",
      "policy-baseline",
    ]);
  });

  it("the duplication choice builds a pair_min_lines command", () => {
    const { changes } = buildChanges(survey, all);
    const argvs = changes.flatMap((change) =>
      change.steps.map((step) => step.argv.join(" ")),
    );

    expect(argvs).toContain(
      "recognizer config sensors.structure.duplication.pair_min_lines 12",
    );
    expect(argvs.some((argv) => argv.includes(".min_lines"))).toBe(false);
    expect(argvs.some((argv) => argv.includes("min_nodes"))).toBe(false);
  });

  it("unticking a coverage tool drops the runners that need it and names them", () => {
    const built = buildChanges(survey, {
      ...all,
      tools: ["cargo-llvm-cov"],
    });

    expect(built.dropped).toEqual([
      { runner: "engine", tool: "@vitest/coverage-v8" },
      { runner: "app", tool: "@vitest/coverage-v8" },
    ]);
    expect(built.changes.map((change) => change.id)).not.toContain(
      "tests-engine",
    );
    expect(built.changes.map((change) => change.id)).toContain("tests-tauri");
    expect(built.changes.map((change) => change.id)).not.toContain(
      "tool-@vitest/coverage-v8",
    );
  });

  it("no tests changes without a plugin that runs tests", () => {
    const ids = titles({ ...all, plugins: [] });

    expect(ids.some((id) => id.startsWith("tests-"))).toBe(false);
    expect(ids.some((id) => id.startsWith("tool-"))).toBe(false);

    const quiet: Survey = {
      ...survey,
      checks: survey.checks.map((check) => ({ ...check, runs_tests: false })),
    };

    expect(titles(all, quiet).some((id) => id.startsWith("tests-"))).toBe(
      false,
    );
  });

  it("a tool already installed gives no install step", () => {
    const ids = titles(all, toolInstalled("cargo-llvm-cov"));

    expect(ids).not.toContain("tool-cargo-llvm-cov");
    expect(ids).toContain("tool-@vitest/coverage-v8");
    expect(ids).toContain("tests-tauri");
  });

  it("a gradle runner's changes set the jacoco format and no runner key", () => {
    const gradle: Survey = {
      ...survey,
      runners: [
        {
          name: "orders",
          language: "kotlin",
          runner: "gradle",
          directory: ".",
          from: "build.gradle.kts",
          command: "./gradlew cleanTest test jacocoTestReport",
          coverage: {
            path: "build/reports/jacoco/test/jacocoTestReport.xml",
            format: "jacoco",
          },
          tool: null,
        },
      ],
    };
    const { changes } = buildChanges(gradle, {
      ...all,
      runners: [{ name: "orders" }],
      tools: [],
    });
    const orders = changes.find((change) => change.id === "tests-orders");

    expect(
      orders?.steps.map((step) => step.argv.slice(2, 4).join(" ")),
    ).toEqual([
      "tests.orders.language kotlin",
      "tests.orders.directory .",
      expect.stringContaining("tests.orders.command"),
      "tests.orders.coverage.path build/reports/jacoco/test/jacocoTestReport.xml",
      "tests.orders.coverage.format jacoco",
    ]);
  });

  it("a tool's prepare commands run before its install and a runner's activate is written", () => {
    const python: Survey = {
      ...survey,
      runners: [
        {
          name: "x",
          language: "python",
          runner: "pytest",
          directory: "tools/x",
          from: "tools/x/requirements-dev.txt",
          command: "pytest --cov",
          coverage: { path: "c/lcov.info", format: "lcov" },
          tool: "pytest-cov",
          activate: "source .venv/bin/activate",
        },
      ],
      tools: [
        {
          name: "pytest-cov",
          kind: "pip",
          installed: false,
          why: "w",
          needed_by: ["x"],
          installs: "i",
          prepare: [["uv", "venv", ".venv"]],
          command: ["uv", "pip", "install", "pytest-cov"],
          cwd: "tools/x",
        },
      ],
    };
    const { changes } = buildChanges(python, {
      ...all,
      runners: [{ name: "x" }],
      tools: ["pytest-cov"],
    });
    const tool = changes.find(
      (change) => change.id === "tool-pytest-cov-tools/x",
    );
    const tests = changes.find((change) => change.id === "tests-x");

    expect(tool?.steps.map((one) => one.argv.join(" "))).toEqual([
      "uv venv .venv",
      "uv pip install pytest-cov",
    ]);
    expect(new Set(tool?.steps.map((one) => one.cwd)).size).toBe(1);

    const keys = tests?.steps.map((one) => one.argv.slice(2, 3).join(" "));
    const command = keys?.findIndex((key) => key === "tests.x.command") ?? -1;

    expect(command).toBeGreaterThan(-1);
    expect(keys?.[command + 1]).toBe("tests.x.activate");
  });

  it("builds a runner as one config command per key, with env added inline", () => {
    const { changes } = buildChanges(survey, all);
    const app = changes.find((change) => change.id === "tests-app");

    expect(app?.steps.map((step) => step.argv.slice(2, 4).join(" "))).toEqual([
      "tests.app.language typescript",
      "tests.app.directory app",
      expect.stringContaining("tests.app.command"),
      "tests.app.runner vitest",
      "tests.app.env.NODE_ENV test",
      "tests.app.coverage.path .recognizer/cache/coverage/app/lcov.info",
      "tests.app.coverage.format lcov",
    ]);

    const tauri = changes.find((change) => change.id === "tests-tauri");

    expect(tauri?.steps.some((step) => step.argv[2]?.endsWith(".runner"))).toBe(
      false,
    );
  });

  it("writes the settings a runner carries, whatever its language", () => {
    const stepsOf = (language: string, settings?: Record<string, string>) => {
      const from: Survey = {
        ...survey,
        runners: survey.runners.map((one) => {
          const { settings: _dropped, ...rest } = one;

          return one.name === "app"
            ? {
                ...rest,
                language,
                ...(settings === undefined ? {} : { settings }),
              }
            : one;
        }),
      };

      return buildChanges(from, all)
        .changes.find((change) => change.id === "tests-app")
        ?.steps.map((step) => step.argv.slice(2, 4).join(" "));
    };

    const typescript = stepsOf("typescript", { runner: "vitest" });

    expect(typescript?.slice(3, 5)).toEqual([
      "tests.app.runner vitest",
      "tests.app.env.NODE_ENV test",
    ]);
    expect(stepsOf("python", { runner: "vitest" })).toContain(
      "tests.app.runner vitest",
    );
    expect(stepsOf("typescript")?.some((one) => one.includes(".runner"))).toBe(
      false,
    );
  });

  it("writes a detected env when the choice names none", () => {
    const detected: Survey = {
      ...survey,
      runners: survey.runners.map((runner) =>
        runner.name === "engine"
          ? { ...runner, env: { NODE_CONFIG_DIR: "./config" } }
          : runner,
      ),
    };
    const stepsFor = (choices: SetupChoices) =>
      buildChanges(detected, choices)
        .changes.find((change) => change.id === "tests-engine")
        ?.steps.map((step) => step.argv.slice(2, 4).join(" ")) ?? [];

    expect(stepsFor(all)).toContain(
      "tests.engine.env.NODE_CONFIG_DIR ./config",
    );
    expect(
      stepsFor({ ...all, runners: [{ name: "engine", env: {} }] }).some(
        (step) => step.includes(".env."),
      ),
    ).toBe(false);
  });

  it("writes the baseline only when an accepted rule is broken today", () => {
    const clean = {
      ...all,
      policy: all.policy?.map((card) =>
        card.kind === "forbid"
          ? { ...card, today: { count: 0, example: null } }
          : card,
      ),
    };

    expect(titles(clean)).not.toContain("policy-baseline");
    expect(titles(all)).toContain("policy-baseline");
  });

  it("applies a fix and lists one that needs the user", () => {
    const withFixes: Survey = {
      ...survey,
      fixes: [
        {
          code: "config-retired",
          subject: "sensors.x",
          title: "t",
          line: "retired",
          fix_text: "t",
          command: "recognizer config --unset sensors.x",
        },
        {
          code: "config-empty",
          subject: "sensors.y",
          title: "t",
          line: "empty",
          fix_text: "t",
          command: "rm -rf /",
        },
      ],
    };
    const built = buildChanges(withFixes, {
      fixes: [
        "recognizer config --unset sensors.x",
        "rm -rf /",
        "recognizer config --unset sensors.z",
      ],
    });

    expect(built.changes.map((change) => change.steps[0]?.argv)).toEqual([
      ["recognizer", "config", "--unset", "sensors.x"],
    ]);
    expect(built.needing_user.map((one) => one.command)).toEqual([
      "rm -rf /",
      "recognizer config --unset sensors.z",
    ]);
  });

  it("returns the groups in the order fixes, checks, tests, policy", () => {
    const command = "recognizer config --unset sensors.x";
    const withFix: Survey = {
      ...survey,
      fixes: [
        {
          code: "config-retired",
          subject: "x",
          title: "t",
          line: "l",
          fix_text: "t",
          command,
        },
      ],
    };
    const groups = buildChanges(withFix, { ...all, fixes: [command] })
      .changes.map((change) => change.group)
      .filter((group, at, list) => list.indexOf(group) === at);

    expect(groups).toEqual(["fixes", "checks", "tests", "policy"]);
  });
});

function configured(): Survey {
  return {
    ...survey,
    configured: true,
    runners: survey.runners.filter((runner) => runner.name !== "engine"),
    suites: [
      {
        name: "engine",
        language: "typescript",
        directory: "engine",
        command: "npx vitest run",
        mark: "set-up",
      },
      {
        name: "legacy",
        language: "python",
        directory: "legacy",
        command: "pytest",
        mark: "gone",
      },
    ],
    checks: survey.checks.map((check) =>
      check.id === "crap" ? { ...check, enabled: true, mark: "set-up" } : check,
    ),
  };
}

describe("rerun changes", () => {
  it("set-up suites are never written and gone ones are removed on request", () => {
    const from = configured();
    const built = buildChanges(from, {
      plugins: ["crap"],
      runners: [{ name: "app" }],
      tools: ["@vitest/coverage-v8"],
      remove_suites: ["legacy", "engine", "nothing"],
    });
    const argvs = built.changes.flatMap((change) =>
      change.steps.map((one) => one.argv.join(" ")),
    );

    expect(built.changes.map((change) => change.id)).toContain(
      "suite-remove-legacy",
    );
    expect(built.changes.map((change) => change.id)).not.toContain(
      "suite-remove-engine",
    );
    expect(built.changes.map((change) => change.id)).not.toContain(
      "suite-remove-nothing",
    );
    expect(argvs).toContain("recognizer config --remove-section tests.legacy");
    expect(argvs.some((line) => line.includes("tests.engine."))).toBe(false);
    expect(argvs.some((line) => line.includes("tests.app."))).toBe(true);
  });

  it("plugins_off turns a set-up check off", () => {
    const from = configured();
    const built = buildChanges(from, {
      plugins_off: ["crap", "mutation"],
    });

    expect(built.changes.map((change) => change.id)).toEqual([
      "plugin-off-crap",
    ]);
    expect(built.changes[0]?.steps[0]?.argv).toEqual([
      "recognizer",
      "config",
      "--remove-section",
      "sensors.crap",
    ]);
  });
});

describe("the built commands", () => {
  it("every built command passes the CLI's own key schema", () => {
    const { changes } = buildChanges(survey, all);
    const keyed = changes
      .flatMap((change) => change.steps)
      .filter(({ argv }) => argv[1] === "config" || argv[1] === "policy");

    expect(keyed.length).toBeGreaterThan(15);

    for (const { argv } of keyed) {
      expect(commandRefusal(argv), argv.join(" ")).toBeNull();
    }
  });
});

describe("fix changes", () => {
  it("show the survey title with the line as detail, and the command alone otherwise", () => {
    const known = {
      code: "config-retired",
      subject: "k",
      title: "Settings moved to new places",
      line: "the full doctor line",
      fix_text: "move it",
      command: "recognizer config --unset k",
    };
    const built = buildChanges(
      { ...survey, fixes: [known] },
      { fixes: [known.command, "recognizer config --unset other"] },
    );

    expect(built.changes).toHaveLength(1);
    expect(built.changes[0]).toMatchObject({
      title: known.title,
      detail: known.line,
    });
    expect(built.needing_user).toEqual([
      {
        command: "recognizer config --unset other",
        reason: "not a finding of the survey",
      },
    ]);
  });
});
