import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import validate from "../src/generated/setup-survey-validator.js";
import { runSetup } from "../src/setup-command.js";
import { folderSlug, type Survey } from "../src/setup-survey.js";
import { capture, REPO } from "./helpers.js";
import { copyLoom, LOOM, shimDirectory, shimmedPath } from "./setup-helpers.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "../dist/bin.js");

let savedPath: string | undefined;
let path: string;

beforeEach(() => {
  savedPath = process.env.PATH;
  path = shimmedPath(shimDirectory());
  process.env.PATH = path;
});

afterEach(() => {
  process.env.PATH = savedPath;
});

function spawnSurvey(args: string[], seed: string): string {
  const result = spawnSync(
    process.execPath,
    [BIN, "setup", "survey", ...args],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: path, PYTHONHASHSEED: seed },
    },
  );

  expect(result.status, result.stderr).toBe(0);

  return result.stdout;
}

async function surveyOf(
  args: string[],
): Promise<{ survey: Survey; status: number }> {
  const out = capture();
  const status = await runSetup(["survey", ...args], out.io);

  return { survey: JSON.parse(out.out()) as Survey, status };
}

describe("recognizer setup survey", () => {
  it("the survey is identical on two runs and lists the runners tools and checks in order", async () => {
    const args = [LOOM, "--scan", join(LOOM, "scan.json")];
    const first = spawnSurvey(args, "1");
    const second = spawnSurvey(args, "2");

    expect(first).toBe(second);

    const survey = JSON.parse(first) as Survey;

    expect(validate(survey), JSON.stringify(validate.errors)).toBe(true);
    expect(survey.runners.map((runner) => runner.name)).toEqual([
      "engine",
      "app",
      "tauri",
    ]);

    const coverage = survey.tools.filter(
      (tool) => tool.name === "@vitest/coverage-v8",
    );

    expect(coverage).toHaveLength(1);
    expect(coverage[0]?.command.join(" ")).toContain("-w engine -w app");
    expect(coverage[0]?.command.join(" ")).toContain(
      "@vitest/coverage-v8@3.2.4",
    );
    expect(coverage[0]?.needed_by).toEqual(["engine", "app"]);
    expect(coverage[0]?.installs).toBe(
      "engine/package.json, app/package.json, package-lock.json",
    );
    expect(survey.tools.map((tool) => tool.name)).toContain("cargo-llvm-cov");
    expect(survey.checks.map((check) => check.id)).toEqual([
      "structure",
      "analysis",
      "crap",
      "mutation",
    ]);
    expect(
      survey.checks
        .filter((check) => check.runs_tests)
        .map((check) => check.id),
    ).toEqual(["crap", "mutation"]);
    expect(survey.unread.map((entry) => entry.language)).toEqual([
      "typescript",
    ]);
    expect(survey.unread[0]?.files).toBe(1);
    expect(survey.files?.map((entry) => entry.language)).toEqual([
      "typescript",
    ]);
  });

  it("the analysis entry carries pair_min_lines with its schema default", async () => {
    const { survey } = await surveyOf([
      LOOM,
      "--scan",
      join(LOOM, "scan.json"),
    ]);
    const analysis = survey.checks.find((check) => check.id === "analysis");
    const pair = analysis?.limits.find(
      (limit) => limit.label === "pair_min_lines",
    );

    expect(pair?.key).toBe("sensors.structure.duplication.pair_min_lines");
    expect(pair?.default).toBe(6);
    expect(analysis?.limits.map((limit) => limit.label)).toEqual([
      "long_function",
      "complexity",
      "pair_min_lines",
    ]);
  });

  it("the survey of this repository lists its real runners", async () => {
    const { survey, status } = await surveyOf([REPO]);
    const names = survey.runners.map(
      (runner) => `${runner.language}:${runner.directory}`,
    );

    expect(status).toBe(0);
    expect(names).toEqual(
      expect.arrayContaining([
        "typescript:check",
        "typescript:app",
        "typescript:scanners/typescript",
        "typescript:describers/claude",
        "rust:app/src-tauri",
      ]),
    );
    const commandOf = (directory: string) =>
      survey.runners.find((runner) => runner.directory === directory)?.command;

    for (const directory of [
      "check",
      "describers/claude",
      "scanners/typescript",
    ]) {
      const command = commandOf(directory) ?? "";

      expect(command).toContain("--config test/vitest.config.ts --coverage");
    }

    expect(commandOf("app")).not.toContain("--config");
    expect(validate(survey), JSON.stringify(validate.errors)).toBe(true);
  });

  it("lists an installed describer as a check that is on once the config has a describer", async () => {
    process.env.PATH = shimmedPath(shimDirectory(true, true));

    const directory = copyLoom();
    const before = await surveyOf([directory]);
    const claude = before.survey.checks.find((check) => check.id === "claude");

    expect(claude).toEqual({
      id: "claude",
      display: "Claude",
      description: "",
      always_on: false,
      enabled: false,
      runs_tests: false,
      limits: [],
      mark: null,
    });
    expect(validate(before.survey), JSON.stringify(validate.errors)).toBe(true);

    mkdirSync(join(directory, ".recognizer"), { recursive: true });
    writeFileSync(
      join(directory, ".recognizer/config.yaml"),
      "describer:\n  command: [recognizer-describe-claude, run, --model, '{model}', '{request}']\n  version: v1\n",
    );

    const after = await surveyOf([directory]);

    expect(
      after.survey.checks.find((check) => check.id === "claude")?.enabled,
    ).toBe(true);
  });

  it("names the root package.json and the lockfile for a vitest suite at the root", async () => {
    const directory = makeTempDir("recognizer-setup-root-");

    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        name: "solo",
        scripts: { test: "vitest run" },
        devDependencies: { vitest: "^3.2.4" },
      }),
    );
    writeFileSync(join(directory, "package-lock.json"), "{}");

    const { survey } = await surveyOf([directory]);
    const coverage = survey.tools.find(
      (tool) => tool.name === "@vitest/coverage-v8",
    );

    expect(coverage?.installs).toBe("package.json, package-lock.json");
  });

  it("suggests a report path under the repository's root cache for every runner", async () => {
    const directory = makeTempDir("recognizer-setup-cache-");
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), text);
    };
    const vitest = JSON.stringify({
      scripts: { test: "vitest run" },
      devDependencies: { vitest: "^3.2.4" },
    });

    write("package.json", vitest);
    write("packages/web/package.json", vitest);
    write(
      "packages/jt/package.json",
      JSON.stringify({
        scripts: { test: "jest" },
        devDependencies: { jest: "^30.0.0" },
      }),
    );
    write("services/api/pyproject.toml", "[tool.pytest]\n");
    write("crates/core/Cargo.toml", '[package]\nname = "core"\n');

    const { survey } = await surveyOf([directory]);
    const runners = survey.runners;

    expect(runners.map((runner) => runner.directory).sort()).toEqual([
      ".",
      "crates/core",
      "packages/jt",
      "packages/web",
      "services/api",
    ]);

    for (const runner of runners) {
      const depth =
        runner.directory === "." ? 0 : runner.directory.split("/").length;
      const folder = `.recognizer/cache/coverage/${folderSlug(runner.name)}`;

      expect(runner.coverage.path).toBe(`${folder}/lcov.info`);
      expect(runner.command).toContain(`${"../".repeat(depth)}${folder}`);

      if (depth === 0) {
        expect(runner.command).not.toContain("..");
      } else {
        expect(runner.command).not.toContain(
          `${"../".repeat(depth + 1)}.recognizer`,
        );
      }
    }
  });

  it("slugs a suite name as the sensors do", () => {
    const rows = JSON.parse(
      readFileSync(join(REPO, "fixtures/suites/folder-slugs.json"), "utf8"),
    ) as { name: string; slug: string }[];

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => /[^A-Za-z0-9._-]/.test(row.name))).toBe(true);
    expect(rows.some((row) => row.name.startsWith("."))).toBe(true);

    for (const row of rows) {
      expect(folderSlug(row.name)).toBe(row.slug);
    }
  });

  it("the loom example puts every runner's report under the root cache", () => {
    const survey = JSON.parse(
      readFileSync(
        join(REPO, "schema/setup-survey-examples/valid/loom.json"),
        "utf8",
      ),
    ) as Survey;

    expect(survey.runners.map((runner) => runner.name)).toEqual([
      "engine",
      "app",
      "tauri",
    ]);

    for (const runner of survey.runners) {
      const depth = runner.directory.split("/").length;
      const folder = `.recognizer/cache/coverage/${runner.name}`;

      expect(runner.coverage.path).toBe(`${folder}/lcov.info`);
      expect(runner.command).toContain(`${"../".repeat(depth)}${folder}`);
    }
  });

  it("prefixes each path with a package root in a subfolder", async () => {
    const directory = makeTempDir("recognizer-setup-sub-");
    const sub = join(directory, "web");

    mkdirSync(join(sub, "engine"), { recursive: true });
    writeFileSync(
      join(sub, "package.json"),
      JSON.stringify({ name: "web", private: true, workspaces: ["engine"] }),
    );
    writeFileSync(
      join(sub, "engine/package.json"),
      JSON.stringify({
        name: "engine",
        scripts: { test: "vitest run" },
        devDependencies: { vitest: "^3.2.4" },
      }),
    );
    writeFileSync(join(sub, "package-lock.json"), "{}");

    const { survey } = await surveyOf([directory]);
    const coverage = survey.tools.find(
      (tool) => tool.name === "@vitest/coverage-v8",
    );

    expect(coverage?.installs).toBe(
      "web/engine/package.json, web/package-lock.json",
    );
  });

  it("lists no describer check when none is installed", async () => {
    const { survey } = await surveyOf([copyLoom()]);

    expect(survey.checks.some((check) => check.id === "claude")).toBe(false);
  });

  it("gives no files when the repository has no scan", async () => {
    const directory = copyLoom();

    rmSync(join(directory, "scan.json"));

    const { survey } = await surveyOf([directory]);

    expect(survey.files).toBeNull();
    expect(survey.configured).toBe(false);
    expect(survey.runners).toHaveLength(3);
  });

  it("refuses a directory that is not there", async () => {
    await expect(
      runSetup(["survey", join(LOOM, "nope")], capture().io),
    ).rejects.toThrow(/not a directory/);
    expect(readFileSync(join(LOOM, "package.json"), "utf8")).toContain(
      "workspaces",
    );
  });
});

function chainRepository(
  server: Record<string, unknown>,
  config = true,
): string {
  const directory = makeTempDir("recognizer-setup-chain-");

  mkdirSync(join(directory, "server"), { recursive: true });
  mkdirSync(join(directory, "web"), { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name: "root",
      workspaces: ["server", "web"],
      devDependencies: { vitest: "^3.2.4" },
    }),
  );
  writeFileSync(join(directory, "server/package.json"), JSON.stringify(server));
  writeFileSync(
    join(directory, "web/package.json"),
    JSON.stringify({ name: "web", scripts: { test: "vitest run" } }),
  );
  writeFileSync(join(directory, "web/vitest.config.ts"), "");

  if (config) {
    writeFileSync(join(directory, "server/vitest.config.ts"), "");
  }

  return directory;
}

const SAGA_SERVER = {
  name: "server",
  scripts: {
    test: "npm run test:unit && npm run test:integration && npm run test:feature",
    "test:unit": "NODE_CONFIG_DIR=./config vitest run",
    "test:integration":
      "NODE_CONFIG_DIR=./config vitest run --config vitest.integration.config.ts",
    "test:feature": "cucumber-js",
  },
  devDependencies: { "@vitest/coverage-v8": "^3.2.4" },
};

describe("a vitest suite behind an npm run chain", () => {
  it("finds a vitest suite behind an npm run chain and carries its env", async () => {
    const { survey } = await surveyOf([chainRepository(SAGA_SERVER)]);

    expect(survey.runners).toHaveLength(2);

    const [server, web] = survey.runners;

    expect(server?.name).toBe("server");
    expect(server?.env).toEqual({ NODE_CONFIG_DIR: "./config" });
    expect(server?.directory).toBe("server");
    expect(server?.from).toBe("server/package.json");
    expect(server?.command).toBe(
      "npx vitest run --coverage --coverage.reporter=lcov --coverage.reportsDirectory=../.recognizer/cache/coverage/server",
    );
    expect(web?.name).toBe("web");
    expect(web).not.toHaveProperty("env");
    expect(
      survey.runners.some((runner) => runner.command.includes("integration")),
    ).toBe(false);
  });

  it("follows nothing without a vitest config beside the package", async () => {
    const { survey } = await surveyOf([chainRepository(SAGA_SERVER, false)]);

    expect(survey.runners.map((runner) => runner.name)).toEqual(["web"]);
  });

  it.each([
    ["cucumber-js", { test: "cucumber-js" }],
    ["a coverage flag", { test: "vitest run --coverage" }],
    ["a coverage setting", { test: "vitest run --coverage.enabled" }],
    ["a watch flag", { test: "vitest --watch" }],
    ["a reporter flag", { test: "vitest run -r dot" }],
    ["another subcommand", { test: "vitest watch" }],
    ["a glob word", { test: "vitest run src/**/*.test.ts" }],
    ["a bare double dash", { test: "vitest run -- x" }],
    ["a cycle", { test: "npm run a", a: "npm run a" }],
    ["a missing script", { test: "npm run missing" }],
    ["a quote in an env value", { test: 'FOO="a b" vitest run' }],
    ["npm run with a workspace flag", { test: "npm run test -w x" }],
  ])(
    "gives no runner when no step is a safe vitest step: %s",
    async (_title, scripts) => {
      const { survey } = await surveyOf([
        chainRepository({ name: "server", scripts }),
      ]);

      expect(survey.runners.map((runner) => runner.name)).toEqual(["web"]);
    },
  );

  it("keeps a vitest script's own arguments in the command", async () => {
    const directory = chainRepository({
      name: "server",
      scripts: { test: "vitest run --config test/vitest.config.ts" },
    });

    rmSync(join(directory, "server/vitest.config.ts"));
    mkdirSync(join(directory, "server/test"), { recursive: true });
    writeFileSync(join(directory, "server/test/vitest.config.ts"), "");

    const { survey } = await surveyOf([directory]);
    const server = survey.runners.find((runner) => runner.name === "server");

    expect(server).toBeDefined();
    expect(server?.command).toBe(
      "npx vitest run --config test/vitest.config.ts --coverage --coverage.reporter=lcov --coverage.reportsDirectory=../.recognizer/cache/coverage/server",
    );
  });

  it("keeps the arguments of a chain step and its env", async () => {
    const { survey } = await surveyOf([
      chainRepository({
        name: "server",
        scripts: {
          test: "npm run unit",
          unit: "NODE_CONFIG_DIR=./config vitest run --project web",
        },
      }),
    ]);
    const server = survey.runners.find((runner) => runner.name === "server");

    expect(server).toBeDefined();
    expect(server?.env).toEqual({ NODE_CONFIG_DIR: "./config" });
    expect(server?.command).toContain("run --project web --coverage");
  });

  it.each([
    [
      "a package with vitest listed and a watch script",
      { test: "vitest --watch" },
    ],
    [
      "a package whose chain names a missing script",
      { test: "npm run missing" },
    ],
  ])(
    "gives no runner for %s without a config beside it",
    async (_title, scripts) => {
      const { survey } = await surveyOf([
        chainRepository(
          {
            name: "server",
            scripts,
            devDependencies: { vitest: "^3.2.4" },
          },
          false,
        ),
      ]);

      expect(survey.runners.map((runner) => runner.name)).toEqual(["web"]);
    },
  );

  it("a hit and a stop in one survey are each their own result", async () => {
    const directory = makeTempDir("recognizer-setup-mixed-");

    for (const [name, test] of [
      ["alpha", "vitest run --config a.ts"],
      ["beta", "vitest run --coverage"],
    ]) {
      mkdirSync(join(directory, name as string), { recursive: true });
      writeFileSync(
        join(directory, name as string, "package.json"),
        JSON.stringify({ name, scripts: { test } }),
      );
    }

    const { survey } = await surveyOf([directory]);

    expect(survey.runners.map((runner) => runner.name)).toEqual(["alpha"]);
    expect(survey.runners[0]?.command).toContain(
      "run --config a.ts --coverage",
    );
  });

  it("the survey of the Saga-shaped fixture lists server and web", async () => {
    const { survey } = await surveyOf([join(REPO, "fixtures/setup-saga")]);

    expect(survey.runners.map((runner) => runner.name)).toEqual([
      "server",
      "web",
    ]);
    expect(survey.runners[0]?.env).toEqual({ NODE_CONFIG_DIR: "./config" });
    expect(validate(survey), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe("setup survey examples", () => {
  const examples = join(REPO, "schema/setup-survey-examples");

  it.each(readdirSync(join(examples, "valid")))("accepts %s", (file) => {
    const value = JSON.parse(
      readFileSync(join(examples, "valid", file), "utf8"),
    );

    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each(readdirSync(join(examples, "invalid")))("rejects %s", (file) => {
    const value = JSON.parse(
      readFileSync(join(examples, "invalid", file), "utf8"),
    );

    expect(validate(value)).toBe(false);
  });
});

describe("setup survey fixes", () => {
  it("fixes carry a title and validate against the schema", () => {
    const loom = JSON.parse(
      readFileSync(
        join(REPO, "schema/setup-survey-examples/valid/loom.json"),
        "utf8",
      ),
    );
    const item = {
      code: "config-duplicate-suite",
      subject: "k",
      title: "Settings moved to new places",
      line: "l",
      fix_text: "edit it",
      command: null,
    };

    expect(validate({ ...loom, fixes: [item] })).toBe(true);
    expect(
      validate({ ...loom, fixes: [{ ...item, command: "recognizer scan" }] }),
    ).toBe(true);

    const { title: _title, ...untitled } = item;

    expect(validate({ ...loom, fixes: [untitled] })).toBe(false);
  });
});

function suiteYaml(name: string, directory: string): string {
  return `  - name: ${name}\n    language: typescript\n    directory: ${directory}\n    command: npx vitest run\n    coverage:\n      path: c/lcov.info\n      format: lcov\n`;
}

function copySaga(config: string | null): string {
  const directory = makeTempDir("recognizer-setup-saga-");

  cpSync(join(REPO, "fixtures/setup-saga"), directory, { recursive: true });

  if (config !== null) {
    mkdirSync(join(directory, ".recognizer"), { recursive: true });
    writeFileSync(join(directory, ".recognizer/config.yaml"), config);
  }

  return directory;
}

describe("setup survey marks", () => {
  it("marks follow the config and the repository", async () => {
    const directory = copySaga(
      `sensors:\n  crap:\n    command: [recognizer-sense-crap]\ntests:\n${suiteYaml("server", "server")}${suiteYaml("legacy", "legacy")}`,
    );
    const { survey } = await surveyOf([directory]);

    expect(survey.suites).toHaveLength(2);
    expect(survey.suites.map((one) => [one.name, one.mark])).toEqual([
      ["legacy", "gone"],
      ["server", "set-up"],
    ]);
    expect(survey.runners.map((one) => one.name)).toEqual(["web"]);
    expect(survey.configured).toBe(true);
    expect(survey.checks.find((check) => check.id === "crap")?.mark).toBe(
      "set-up",
    );
    expect(survey.checks.find((check) => check.id === "mutation")?.mark).toBe(
      "new",
    );
    expect(validate(survey), JSON.stringify(validate.errors)).toBe(true);
  });

  it("a suite is gone when its folder holds no file", async () => {
    const directory = copySaga(
      `tests:\n${suiteYaml("root", ".")}${suiteYaml("empty", "nowhere")}`,
    );
    const { survey } = await surveyOf([directory]);

    expect(survey.suites).toHaveLength(2);
    expect(survey.suites.find((one) => one.name === "root")?.mark).toBe(
      "set-up",
    );
    expect(survey.suites.find((one) => one.name === "empty")?.mark).toBe(
      "gone",
    );
  });

  it("a hand-written suite whose folder exists stays set up", async () => {
    const directory = copySaga(`tests:\n${suiteYaml("hand", "web")}`);
    const { survey } = await surveyOf([directory]);

    expect(survey.suites).toHaveLength(1);
    expect(survey.suites[0]?.mark).toBe("set-up");
  });

  it("a moved folder leaves the old suite gone and names the new runner afresh", async () => {
    const directory = copySaga(`tests:\n${suiteYaml("web", "old/web")}`);
    const { survey } = await surveyOf([directory]);

    expect(survey.suites.map((one) => [one.name, one.mark])).toEqual([
      ["web", "gone"],
    ]);
    expect(survey.runners.map((one) => one.name)).toEqual(["server", "web-2"]);
  });

  it("without a config every mark is null and suites is empty", async () => {
    const { survey } = await surveyOf([copySaga(null)]);

    expect(survey.configured).toBe(false);
    expect(survey.suites).toEqual([]);
    expect(survey.checks.length).toBeGreaterThan(0);
    expect(survey.checks.every((check) => check.mark === null)).toBe(true);
    expect(survey.runners.map((one) => one.name)).toEqual(["server", "web"]);
  });

  it("a language named only by a scanners key with no files is gone", async () => {
    const directory = copyLoom();

    mkdirSync(join(directory, ".recognizer"), { recursive: true });
    writeFileSync(
      join(directory, ".recognizer/config.yaml"),
      "scanners:\n  kotlin: recognizer-scan-kotlin\n",
    );

    const { survey } = await surveyOf([
      directory,
      "--scan",
      join(LOOM, "scan.json"),
    ]);
    const kotlin = survey.files?.find((one) => one.language === "kotlin");

    expect(kotlin).toEqual({
      language: "kotlin",
      files: 0,
      folders: [],
      mark: "gone",
    });
    expect(
      survey.files?.find((one) => one.language === "typescript")?.mark,
    ).toBe("new");
  });

  it("leaves an unregistered plugin the Checks step offers out of the fixes", async () => {
    process.env.PATH = shimmedPath(shimDirectory(true, true));

    const directory = copySaga("overlays:\n  x: 1\n");
    const { survey } = await surveyOf([directory]);

    expect(survey.checks.some((check) => check.id === "claude")).toBe(true);
    expect(
      survey.fixes.filter((one) => one.code === "unregistered-plugin"),
    ).toEqual([]);
    expect(survey.fixes.some((one) => one.code === "config-retired")).toBe(
      true,
    );
  });

  it("lists every problem as a fix, runnable or by hand", async () => {
    const directory = copySaga(
      `overlays:\n  x: 1\ntests:\n${suiteYaml("dup", "web")}${suiteYaml("dup", "web")}`,
    );
    const { survey } = await surveyOf([directory]);

    expect(survey.fixes.length).toBeGreaterThanOrEqual(2);

    const retired = survey.fixes.find((one) => one.code === "config-retired");
    const duplicate = survey.fixes.find(
      (one) => one.code === "config-duplicate-suite",
    );

    expect(retired?.command).not.toBeNull();
    expect(duplicate?.command).toBeNull();
    expect(duplicate?.fix_text.length).toBeGreaterThan(0);
  });
});

describe("setup survey policy", () => {
  function scanOf(ids: string[]): string {
    const base = JSON.parse(readFileSync(join(LOOM, "scan.json"), "utf8")) as {
      modules: unknown[];
    };
    const directory = makeTempDir("recognizer-setup-scan-");
    const file = join(directory, "scan.json");

    writeFileSync(
      file,
      JSON.stringify({
        ...base,
        modules: ids.map((id) => ({
          id,
          language: "typescript",
          kind: "module",
          members: [],
        })),
      }),
    );

    return file;
  }

  async function uncovered(policy: string | null): Promise<string[]> {
    const directory = copyLoom();

    if (policy !== null) {
      mkdirSync(join(directory, ".recognizer"), { recursive: true });
      writeFileSync(join(directory, ".recognizer/policy.yaml"), policy);
    }

    const { survey } = await surveyOf([
      directory,
      "--scan",
      scanOf(["server/a.ts", "web/b.ts", "root.ts"]),
    ]);

    return survey.policy.uncovered;
  }

  it("policy reports folders no part covers", async () => {
    expect(await uncovered("entry:\n  - server/**\n")).toEqual([".", "web"]);
    expect(
      await uncovered("entry:\n  - server/**\nignore:\n  - web/**\n"),
    ).toEqual(["."]);
    expect(await uncovered(null)).toEqual([]);
    expect(await uncovered("forbid: nonsense\n")).toEqual([]);
  });

  it("a null scan gives no uncovered folders", async () => {
    const directory = copyLoom();

    mkdirSync(join(directory, ".recognizer"), { recursive: true });
    writeFileSync(
      join(directory, ".recognizer/policy.yaml"),
      "entry:\n  - server/**\n",
    );

    const { survey } = await surveyOf([directory]);

    expect(survey.policy).toEqual({ present: true, uncovered: [] });
  });
});

describe("setup survey gradle suites", () => {
  function tree(files: Record<string, string>): string {
    const directory = makeTempDir("recognizer-setup-kt-");

    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, name)), { recursive: true });
      writeFileSync(join(directory, name), text);
    }

    return directory;
  }

  const KOTLIN_BUILD = `plugins {\n    kotlin("jvm") version "2.0.0"\n    id("jacoco")\n}\n`;
  const COMMAND = "./gradlew cleanTest test jacocoTestReport";
  const DEFAULT_PATH = "build/reports/jacoco/test/jacocoTestReport.xml";

  it("a Kotlin DSL build with JaCoCo gives one runner with the command and the default path", async () => {
    const directory = tree({
      "build.gradle.kts": KOTLIN_BUILD,
      gradlew: "",
      "src/main/kotlin/A.kt": "class A\n",
    });
    const { survey } = await surveyOf([directory]);

    expect(survey.runners).toHaveLength(1);
    expect(survey.runners[0]).toMatchObject({
      language: "kotlin",
      runner: "gradle",
      directory: ".",
      command: COMMAND,
      coverage: { path: DEFAULT_PATH, format: "jacoco" },
      tool: null,
    });
    expect(survey.notes).toEqual([]);
    expect(validate(survey), JSON.stringify(validate.errors)).toBe(true);
  });

  it("a Groovy build with xml.outputLocation gives that path", async () => {
    const groovy = tree({
      "build.gradle": `plugins {\n    id 'jacoco'\n}\njacocoTestReport {\n    reports {\n        xml.outputLocation = layout.buildDirectory.file('coverage/jacoco.xml')\n    }\n}\n`,
      gradlew: "",
    });
    const kotlin = tree({
      "build.gradle.kts": `${KOTLIN_BUILD}tasks.jacocoTestReport {\n    reports {\n        xml.outputLocation.set(layout.buildDirectory.file("coverage/j.xml"))\n    }\n}\n`,
      gradlew: "",
    });
    const first = await surveyOf([groovy]);
    const second = await surveyOf([kotlin]);

    expect(first.survey.runners).toHaveLength(1);
    expect(first.survey.runners[0]?.coverage.path).toBe(
      "build/coverage/jacoco.xml",
    );
    expect(second.survey.runners).toHaveLength(1);
    expect(second.survey.runners[0]?.coverage.path).toBe(
      "build/coverage/j.xml",
    );
  });

  it("a build with a pactTest task gives only the test suite", async () => {
    const directory = tree({
      "build.gradle.kts": `${KOTLIN_BUILD}val pactTest by tasks.registering(Test::class) { }\ntasks.register<Test>("integrationTest") { }\n`,
      gradlew: "",
      "src/pactTest/kotlin/P.kt": "class P\n",
      "src/main/kotlin/A.kt": "class A\n",
    });
    const { survey } = await surveyOf([directory]);

    expect(survey.runners).toHaveLength(1);
    expect(survey.runners[0]?.command).toContain("test");
    expect(survey.runners[0]?.command).not.toContain("pactTest");
    expect(survey.runners[0]?.command).not.toContain("integrationTest");
  });

  it("a build without JaCoCo gives no runner and the add-JaCoCo note", async () => {
    const directory = tree({
      "build.gradle.kts": `plugins {\n    id("io.micronaut.application")\n}\n`,
      gradlew: "",
      "src/main/kotlin/A.kt": "class A\n",
    });
    const { survey } = await surveyOf([directory]);

    expect(survey.runners).toEqual([]);
    expect(survey.notes).toHaveLength(1);
    expect(survey.notes?.[0]?.directory).toBe(".");
    expect(survey.notes?.[0]?.text).toContain('id("jacoco")');
    expect(survey.notes?.[0]?.text).toContain("build.gradle.kts");
  });

  it("a build with no Kotlin sources and no JaCoCo gives nothing", async () => {
    const javaOnly = tree({
      "build.gradle.kts": `plugins {\n    java\n}\n`,
      "src/main/java/A.java": "class A {}\n",
    });
    const untracked = tree({
      "build.gradle.kts": `plugins {\n    java\n}\n`,
      "bin/main/A.kt": "class A\n",
    });

    for (const directory of [javaOnly, untracked]) {
      const { survey } = await surveyOf([directory]);

      expect(survey.runners).toEqual([]);
      expect(survey.notes).toEqual([]);
    }
  });

  it("an unreadable report path gives the default path and a note", async () => {
    const dollar = tree({
      "build.gradle.kts": `${KOTLIN_BUILD}tasks.jacocoTestReport {\n    reports.xml.outputLocation = file("\${buildDir}/x.xml")\n}\n`,
      gradlew: "",
    });
    const two = tree({
      "build.gradle": `plugins {\n    id 'jacoco'\n}\na { xml.outputLocation = layout.buildDirectory.file('a.xml') }\nb { xml.outputLocation = layout.buildDirectory.file('b.xml') }\n`,
      gradlew: "",
    });

    for (const directory of [dollar, two]) {
      const { survey } = await surveyOf([directory]);

      expect(survey.runners).toHaveLength(1);
      expect(survey.runners[0]?.coverage.path).toBe(DEFAULT_PATH);
      expect(
        survey.notes?.some((note) => note.text.includes("may differ")),
      ).toBe(true);
    }
  });

  it("jacoco applied only from subprojects gives no runner", async () => {
    const directory = tree({
      "build.gradle": `subprojects {\n    apply plugin: 'jacoco'\n}\n`,
      gradlew: "",
      "src/main/kotlin/A.kt": "class A\n",
    });
    const { survey } = await surveyOf([directory]);

    expect(survey.runners).toEqual([]);
    expect(
      survey.notes?.some((note) => note.text.includes('id("jacoco")')),
    ).toBe(true);
  });

  it("each subproject with a build file is its own suite and finds the wrapper above it", async () => {
    const directory = tree({
      gradlew: "",
      "settings.gradle.kts": `include("svc-a", "svc-b")\n`,
      "svc-a/build.gradle.kts": KOTLIN_BUILD,
      "svc-a/src/main/kotlin/A.kt": "class A\n",
      "svc-b/build.gradle.kts": `plugins {\n    kotlin("jvm")\n}\n`,
      "svc-b/src/main/kotlin/B.kt": "class B\n",
    });
    const { survey } = await surveyOf([directory]);

    expect(survey.runners).toHaveLength(1);
    expect(survey.runners[0]).toMatchObject({
      directory: "svc-a",
      command: "../gradlew cleanTest test jacocoTestReport",
    });
    expect(survey.notes).toHaveLength(1);
    expect(survey.notes?.[0]?.directory).toBe("svc-b");
    expect(survey.notes?.[0]?.text).toContain('id("jacoco")');
  });

  it("no wrapper gives the assumed command and a note", async () => {
    const directory = tree({
      "build.gradle.kts": KOTLIN_BUILD,
      "src/main/kotlin/A.kt": "class A\n",
    });
    const { survey } = await surveyOf([directory]);

    expect(survey.runners).toHaveLength(1);
    expect(survey.runners[0]?.command).toBe(COMMAND);
    expect(
      survey.notes?.some((note) => note.text.includes("no Gradle wrapper")),
    ).toBe(true);
  });

  it("a configured suite hides the runner and the note", async () => {
    const directory = tree({
      "build.gradle.kts": KOTLIN_BUILD,
      "src/main/kotlin/A.kt": "class A\n",
      ".recognizer/config.yaml":
        "tests:\n  - name: root\n    language: kotlin\n    directory: .\n    command: ./gradlew test\n    coverage:\n      path: build/x.xml\n      format: jacoco\n",
    });
    const { survey } = await surveyOf([directory]);

    expect(survey.suites).toHaveLength(1);
    expect(survey.runners).toEqual([]);
    expect(survey.notes).toEqual([]);
  });
});
