import { spawnSync } from "node:child_process";
import {
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
    [
      "a first vitest step with other arguments",
      {
        test: "npm run test:unit",
        "test:unit": "vitest run --config x.ts",
      },
    ],
    ["a cycle", { test: "npm run a", a: "npm run a" }],
    ["a missing script", { test: "npm run missing" }],
    ["a quote in an env value", { test: 'FOO="a b" vitest run' }],
    ["npm run with a workspace flag", { test: "npm run test -w x" }],
  ])(
    "gives no runner when no step is a plain vitest step: %s",
    async (_title, scripts) => {
      const { survey } = await surveyOf([
        chainRepository({ name: "server", scripts }),
      ]);

      expect(survey.runners.map((runner) => runner.name)).toEqual(["web"]);
    },
  );

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
