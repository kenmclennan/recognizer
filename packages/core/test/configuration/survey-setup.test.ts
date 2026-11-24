import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  InvalidRequest,
  type LanguageRule,
  surveySetup,
} from "../../src/index.js";
import {
  type ConfigurationWorld,
  ignoring,
  ROOT,
  scanOfFiles,
  seedFiles,
  worldOf,
} from "./world.js";

const NO_SKIP = {
  directory_names: [],
  directory_prefixes: [],
  directory_suffixes: [],
  directory_markers: [],
  file_globs: [],
};
const PYTHON = {
  name: "python",
  extensions: [".py"],
  files: [],
  skip: NO_SKIP,
};
const TYPESCRIPT = {
  name: "typescript",
  extensions: [".ts"],
  files: ["tsconfig.json"],
  skip: NO_SKIP,
};

function committedRules(): LanguageRule[] {
  const here = dirname(fileURLToPath(import.meta.url));

  return JSON.parse(
    readFileSync(
      resolve(here, "../../../../fixtures/plugins/languages.json"),
      "utf8",
    ),
  );
}

function claiming(world: ConfigurationWorld, claims: LanguageRule[]): void {
  world.ports.reads = { ...world.ports.reads, languageRules: () => claims };
}

const NO_RUNNER_NOTE = (language: string, count: number) => ({
  language,
  directory: ".",
  text: `${language} is the largest language here (${count} files) and no test runner was found for it, so a sensor that runs tests will cover only part of this repository`,
});

const CONFIG_PATH = `${ROOT}/.recognizer/config.yaml`;
const POLICY_PATH = `${ROOT}/.recognizer/policy.yaml`;

describe("surveySetup", () => {
  it("the survey is identical on two runs and lists the runners tools and checks", async () => {
    const world = worldOf();

    seedFiles(world, ["engine/package.json", "engine/src/a.ts"]);
    world.fakes.surveyPlugins.seeded = [
      {
        plugin: "typescript",
        order: 1,
        language: "typescript",
        answer: {
          runners: [
            {
              language: "typescript",
              runner: "vitest",
              directory: "engine",
              from: "engine/package.json",
              command: "npx vitest run",
              coverage: { path: "c/lcov.info", format: "lcov" },
              tool: null,
            },
          ],
          tools: [],
          notes: [],
        },
      },
    ];

    const first = await surveySetup(world.ports, { root: ROOT });
    const second = await surveySetup(world.ports, { root: ROOT });

    expect(second).toEqual(first);
    expect(first.runners.map((runner) => runner.name)).toEqual(["engine"]);
    expect(first.repository).toBe(ROOT);
    expect(first.survey_version).toBe(1);
    expect(first.version).toBe("0.0.0-test");
    expect(first.checks.map((check) => check.id)).toEqual([
      "structure",
      "analysis",
    ]);
    expect(first.checks[1]?.limits).toEqual([
      {
        key: "sensors.structure.warnings.long_function.limit",
        label: "long_function",
        default: 40,
        current: null,
      },
      {
        key: "sensors.structure.warnings.complexity.limit",
        label: "complexity",
        default: 10,
        current: null,
      },
      {
        key: "sensors.structure.duplication.pair_min_lines",
        label: "pair_min_lines",
        default: 8,
        current: null,
      },
    ]);
  });

  it("filterListing keeps target and node_modules folders and drops dist and .git parts", async () => {
    const world = worldOf();

    seedFiles(world, [
      "target/c.rs",
      "dist/a.ts",
      ".git/x",
      "node_modules/y.ts",
      "a.ts",
    ]);
    await surveySetup(world.ports, { root: ROOT });

    expect(world.fakes.surveyPlugins.requests[0]?.files).toEqual([
      "a.ts",
      "node_modules/y.ts",
      "target/c.rs",
    ]);
  });

  it("asks the plugins with the file list and the configured suites", async () => {
    const world = worldOf();

    seedFiles(world, ["b.ts", "node_modules/x/a.ts", "a.ts", "target/c.rs"]);
    world.fakes.config.setup = {
      tests: [{ name: "old", language: "python", directory: "legacy" }],
    };
    await surveySetup(world.ports, { root: ROOT });

    expect(world.fakes.surveyPlugins.requests).toEqual([
      {
        root: ROOT,
        files: ["a.ts", "b.ts", "node_modules/x/a.ts", "target/c.rs"],
        suites: [{ language: "python", directory: "legacy" }],
      },
    ]);
  });

  it("refuses a directory that is not there", async () => {
    const world = worldOf();

    await expect(
      surveySetup(world.ports, { root: "/work/missing" }),
    ).rejects.toThrow(InvalidRequest);
    await expect(
      surveySetup(world.ports, { root: "/work/missing" }),
    ).rejects.toThrow("repository is not a directory: /work/missing");
  });

  it("marks languages, suites and checks against the config", async () => {
    const world = worldOf();

    seedFiles(world, ["a/x.ts", "b/y.py", "legacy/z.py"]);
    world.fakes.setupFiles.seed(CONFIG_PATH, "x");
    world.fakes.config.setup = {
      scanners: { gone: "x" },
      tests: [
        { name: "a", language: "typescript", directory: "a", command: "t" },
        { name: "old", language: "python", directory: "missing", command: "p" },
      ],
    };

    const scan = scanOfFiles(["a/x.ts"]);
    const survey = await surveySetup(world.ports, { root: ROOT, scan });

    expect(survey.configured).toBe(true);
    expect(survey.files?.map((one) => [one.language, one.mark])).toEqual([
      ["gone", "gone"],
      ["python", "gone"],
      ["typescript", "set-up"],
    ]);
    expect(survey.suites.map((one) => [one.name, one.mark])).toEqual([
      ["a", "set-up"],
      ["old", "gone"],
    ]);
    expect(survey.checks.map((one) => one.mark)).toEqual(["set-up", "set-up"]);
  });

  it("gives no files when the repository has no scan", async () => {
    const world = worldOf();
    const survey = await surveySetup(world.ports, { root: ROOT });

    expect(survey.files).toBeNull();
    expect(survey.configured).toBe(true);
  });

  it("covers the policy by folder", async () => {
    const world = worldOf();

    world.fakes.setupFiles.seed(POLICY_PATH, "");
    world.fakes.policy.held = ignoring("scripts/*");

    const scan = scanOfFiles(["scripts/a.ts", "src/b.ts", "root.ts"]);
    const survey = await surveySetup(world.ports, { root: ROOT, scan });

    expect(survey.policy).toEqual({ present: true, uncovered: [".", "src"] });

    const without = worldOf();

    expect(
      (await surveySetup(without.ports, { root: ROOT, scan })).policy,
    ).toEqual({ present: false, uncovered: [".", "scripts", "src"] });
  });

  it("offers a runnable fix and keeps the command of none the grammar refuses", async () => {
    const world = worldOf();

    world.fakes.repositoryChecks.configReading.problems = [
      {
        code: "config-retired",
        subject: "sensors.x",
        line: "retired",
        fix: {
          text: "unset it",
          command: "recognizer config --unset sensors.x",
        },
      },
      {
        code: "config-empty",
        subject: "sensors.y",
        line: "empty",
        fix: { text: "remove it", command: "rm -rf /" },
      },
    ];

    const survey = await surveySetup(world.ports, { root: ROOT });

    expect(
      survey.fixes
        .filter((fix) => fix.code.startsWith("config-"))
        .map((fix) => [fix.code, fix.command]),
    ).toEqual([
      ["config-retired", "recognizer config --unset sensors.x"],
      ["config-empty", null],
    ]);
  });
});

describe("setup survey gap notes", () => {
  it("the largest language with no runner gets a survey note", async () => {
    const world = worldOf();

    claiming(world, [TYPESCRIPT]);
    seedFiles(world, ["a.go", "b.go", "c.ts"]);

    const survey = await surveySetup(world.ports, { root: ROOT });

    expect(survey.notes).toEqual([NO_RUNNER_NOTE("typescript", 1)]);
  });

  it("a tie breaks by name and a file claimed by base name counts", async () => {
    const world = worldOf();

    claiming(world, [TYPESCRIPT, PYTHON]);
    seedFiles(world, ["a.py", "b.py", "c.ts", "tsconfig.json"]);

    expect((await surveySetup(world.ports, { root: ROOT })).notes).toEqual([
      NO_RUNNER_NOTE("python", 2),
    ]);
  });

  it("an undeclared language gets no note", async () => {
    const world = worldOf();

    claiming(world, []);
    seedFiles(world, ["a.go"]);

    expect((await surveySetup(world.ports, { root: ROOT })).notes).toEqual([]);
  });

  it("claimed files are counted and unclaimed ones appear nowhere", async () => {
    const world = worldOf();

    claiming(world, [TYPESCRIPT, PYTHON]);
    seedFiles(world, [
      "a.py",
      "b.py",
      "c.py",
      "d.ts",
      "tsconfig.json",
      "e.java",
      "f.java",
      "g.java",
      "h.md",
    ]);

    const survey = await surveySetup(world.ports, { root: ROOT });

    expect(survey.notes).toEqual([NO_RUNNER_NOTE("python", 3)]);
    expect(JSON.stringify(survey)).not.toMatch(/java|\.md/);
  });

  it("the survey has no unread field", async () => {
    const world = worldOf();

    claiming(world, [PYTHON]);
    seedFiles(world, ["a.py", "b.go"]);

    expect(await surveySetup(world.ports, { root: ROOT })).not.toHaveProperty(
      "unread",
    );
  });

  it("skipped files do not count toward the largest language", async () => {
    const world = worldOf();
    const files = [
      "src/a.py",
      "src/b.py",
      "src/c.py",
      "tests/d.py",
      "tests/e.py",
      "a.ts",
      "b.ts",
      "c.ts",
    ];

    claiming(world, committedRules());
    seedFiles(world, files);

    expect((await surveySetup(world.ports, { root: ROOT })).notes).toEqual([
      NO_RUNNER_NOTE("python", 3),
    ]);

    seedFiles(world, [...files, "d.ts"]);

    expect((await surveySetup(world.ports, { root: ROOT })).notes).toEqual([
      NO_RUNNER_NOTE("typescript", 4),
    ]);
  });

  it("a language whose files are all skipped gets no note", async () => {
    const world = worldOf();

    claiming(world, committedRules());
    seedFiles(world, ["tests/a.py"]);

    expect((await surveySetup(world.ports, { root: ROOT })).notes).toEqual([]);
  });

  it("the committed language rules give the expected note data", async () => {
    const world = worldOf();
    const here = dirname(fileURLToPath(import.meta.url));
    const rules = JSON.parse(
      readFileSync(
        resolve(here, "../../../../fixtures/plugins/languages.json"),
        "utf8",
      ),
    );

    claiming(world, rules);
    seedFiles(world, [
      "a.py",
      "b.py",
      "c.py",
      "d.ts",
      "tsconfig.json",
      "e.java",
      "f.java",
      "g.java",
      "h.md",
    ]);

    expect((await surveySetup(world.ports, { root: ROOT })).notes).toEqual([
      NO_RUNNER_NOTE("python", 3),
    ]);
  });

  it("no gap note when every language with files has a runner", async () => {
    const world = worldOf();

    claiming(world, [TYPESCRIPT]);
    seedFiles(world, ["a.ts", "b.ts"]);
    world.fakes.surveyPlugins.seeded = [
      {
        plugin: "typescript",
        order: 1,
        language: "typescript",
        answer: {
          runners: [
            {
              language: "typescript",
              runner: "vitest",
              directory: ".",
              from: "package.json",
              command: "c",
              coverage: { path: "p", format: "lcov" },
              tool: null,
            },
          ],
          tools: [],
          notes: [],
        },
      },
    ];

    expect((await surveySetup(world.ports, { root: ROOT })).notes).toEqual([]);
  });

  it("a language that already has a note gets no gap note", async () => {
    const world = worldOf();

    claiming(world, [PYTHON]);
    seedFiles(world, ["a.py", "b.py"]);
    world.fakes.surveyPlugins.seeded = [
      {
        plugin: "python",
        order: 1,
        language: "python",
        answer: {
          runners: [],
          tools: [],
          notes: [{ language: "python", directory: ".", text: "no env" }],
        },
      },
    ];

    expect((await surveySetup(world.ports, { root: ROOT })).notes).toEqual([
      { language: "python", directory: ".", text: "no env" },
    ]);
  });

  describe("coverage format", () => {
    const KEY = ["tests", "<name>", "coverage", "format"].join(".");

    function publishing(world: ConfigurationWorld, values?: string[]): void {
      world.fakes.keyOwners.schema = {
        ...world.fakes.keyOwners.schema,
        keys: [
          {
            key: KEY,
            type: "enum",
            description: "d",
            example: "e",
            ...(values === undefined ? {} : { values }),
          },
        ],
      };
    }

    function answering(world: ConfigurationWorld, format: string): void {
      seedFiles(world, ["engine/package.json", "engine/src/a.ts"]);
      world.fakes.surveyPlugins.seeded = [
        {
          plugin: "typescript",
          order: 1,
          language: "typescript",
          answer: {
            runners: [
              {
                language: "typescript",
                runner: "vitest",
                directory: "engine",
                from: "engine/package.json",
                command: "npx vitest run",
                coverage: { path: "c/lcov.info", format },
                tool: null,
              },
            ],
            tools: [],
            notes: [],
          },
        },
      ];
    }

    it("refuses a format the sensors do not publish", async () => {
      const world = worldOf();

      publishing(world, ["lcov", "jacoco"]);
      answering(world, "cobertura");

      const survey = await surveySetup(world.ports, { root: ROOT });

      expect(survey.runners).toEqual([]);
      expect(survey.notes[0]?.text).toContain(
        "which no installed sensor reads (they read: lcov, jacoco)",
      );
    });

    it("accepts any format when the sensors publish no values", async () => {
      const world = worldOf();

      publishing(world);
      answering(world, "cobertura");

      const survey = await surveySetup(world.ports, { root: ROOT });

      expect(survey.runners.map((runner) => runner.name)).toEqual(["engine"]);
    });

    it("reads no key schema when no runner was answered", async () => {
      const world = worldOf();

      await surveySetup(world.ports, { root: ROOT });

      expect(world.fakes.keyOwners.reads).toBe(0);
    });
  });

  describe("published suite values", () => {
    const SUITE_KEYS = [
      ["tests.<name>.language", ["python", "typescript", "kotlin"]],
      ["tests.<name>.runner", ["vitest", "jest"]],
      ["tests.<name>.coverage.format", ["lcov", "jacoco"]],
    ] as const;

    function publishingSuiteKeys(world: ConfigurationWorld): void {
      world.fakes.keyOwners.schema = {
        ...world.fakes.keyOwners.schema,
        keys: SUITE_KEYS.map(([key, values]) => ({
          key,
          type: "enum" as const,
          description: "d",
          example: "e",
          values: [...values],
        })),
      };
    }

    function plugin(
      name: string,
      order: number,
      given: { language: string; runner?: string; format: string },
    ) {
      return {
        plugin: name,
        order,
        language: given.language,
        answer: {
          runners: [
            {
              language: given.language,
              runner: "vitest",
              directory: name,
              from: `${name}/package.json`,
              command: "npx vitest run",
              coverage: { path: "c/lcov.info", format: given.format },
              tool: null,
              ...(given.runner === undefined
                ? {}
                : { settings: { runner: given.runner } }),
            },
          ],
          tools: [],
          notes: [],
        },
      };
    }

    async function surveyOf(
      ...answers: ReturnType<typeof plugin>[]
    ): Promise<Awaited<ReturnType<typeof surveySetup>>> {
      const world = worldOf();

      publishingSuiteKeys(world);
      seedFiles(
        world,
        answers.map((one) => `${one.plugin}/package.json`),
      );
      world.fakes.surveyPlugins.seeded = answers;

      return surveySetup(world.ports, { root: ROOT });
    }

    it("keeps a runner whose language, runner and format are all published", async () => {
      const survey = await surveyOf(
        plugin("good", 1, {
          language: "typescript",
          runner: "jest",
          format: "lcov",
        }),
      );

      expect(survey.runners.map((one) => one.name)).toEqual(["good"]);
      expect(survey.notes).toEqual([]);
    });

    it("drops a runner whose language no sensor publishes", async () => {
      const survey = await surveyOf(
        plugin("odd", 1, { language: "zig", format: "lcov" }),
      );

      expect(survey.runners).toEqual([]);
      expect(survey.notes[0]?.text).toContain(
        "answers language zig, which no installed sensor reads (they read: python, typescript, kotlin)",
      );
    });

    it("drops a runner whose runner setting no sensor publishes", async () => {
      const survey = await surveyOf(
        plugin("odd", 1, {
          language: "typescript",
          runner: "mocha",
          format: "lcov",
        }),
      );

      expect(survey.runners).toEqual([]);
      expect(survey.notes[0]?.text).toContain(
        "answers runner mocha, which no installed sensor reads (they read: vitest, jest)",
      );
    });

    it("keeps the good runner and drops the bad one in the same survey", async () => {
      const survey = await surveyOf(
        plugin("good", 1, { language: "python", format: "jacoco" }),
        plugin("bad", 2, { language: "python", format: "tap" }),
      );

      expect(survey.runners.map((one) => one.name)).toEqual(["good"]);
      expect(survey.notes).toHaveLength(1);
      expect(survey.notes[0]?.text).toContain("bad did not answer");
    });
  });
});
