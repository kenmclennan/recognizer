import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { InvalidRequest, surveySetup } from "../../src/index.js";
import {
  type ConfigurationWorld,
  ignoring,
  ROOT,
  scanOfFiles,
  seedFiles,
  worldOf,
} from "./world.js";

const PYTHON = { name: "python", extensions: [".py"], files: [] };
const TYPESCRIPT = {
  name: "typescript",
  extensions: [".ts"],
  files: ["tsconfig.json"],
};

function claiming(
  world: ConfigurationWorld,
  claims: { name: string; extensions: string[]; files: string[] }[],
): void {
  world.ports.reads = { ...world.ports.reads, languageRules: () => claims };
}

const NO_RUNNER_NOTE = (language: string, count: number) => ({
  language,
  directory: ".",
  text: `${language} is the largest language here (${count} files) and no test runner was found for it, so C.R.A.P. and Mutation will cover only part of this repository`,
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
        files: ["a.ts", "b.ts"],
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
});
