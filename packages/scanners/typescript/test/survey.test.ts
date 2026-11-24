import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { type SurveyAnswer, survey } from "../src/survey.js";
import { BIN, REPO } from "./helpers.js";

const validateAnswer = new Ajv2020({ allErrors: true }).compile(
  JSON.parse(
    readFileSync(join(REPO, "schema/survey-answer.schema.json"), "utf8"),
  ),
);

function filesUnder(root: string, directory = ""): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(join(root, directory), {
    withFileTypes: true,
  }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = posix.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git") {
        found.push(...filesUnder(root, path));
      }
    } else {
      found.push(path);
    }
  }

  return found;
}

function answerOf(
  root: string,
  suites: { language: string; directory: string }[] = [],
): SurveyAnswer {
  const answer = survey({ root, files: filesUnder(root), suites });

  expect(validateAnswer(answer), JSON.stringify(validateAnswer.errors)).toBe(
    true,
  );

  return answer;
}

function directories(answer: SurveyAnswer): string[] {
  return answer.runners.map((runner) => runner.directory);
}

describe("survey answer", () => {
  it("names the root package.json and the lockfile for a vitest suite at the root", () => {
    const directory = makeTempDir("recognizer-survey-root-");

    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        name: "solo",
        scripts: { test: "vitest run" },
        devDependencies: { vitest: "^3.2.4" },
      }),
    );
    writeFileSync(join(directory, "package-lock.json"), "{}");

    const coverage = answerOf(directory).tools.find(
      (tool) => tool.name === "@vitest/coverage-v8",
    );

    expect(coverage?.installs).toBe("package.json, package-lock.json");
    expect(coverage?.needed_by).toEqual(["package.json"]);
  });

  it("prefixes each path with a package root in a subfolder", () => {
    const directory = makeTempDir("recognizer-survey-sub-");
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

    const coverage = answerOf(directory).tools.find(
      (tool) => tool.name === "@vitest/coverage-v8",
    );

    expect(coverage?.installs).toBe(
      "web/engine/package.json, web/package-lock.json",
    );
  });

  it("runs the install from a lone package's own folder with no workspace flag", () => {
    const directory = makeTempDir("recognizer-survey-lone-");

    mkdirSync(join(directory, "client"), { recursive: true });
    writeFileSync(
      join(directory, "client/package.json"),
      JSON.stringify({
        name: "client",
        scripts: { test: "vitest run" },
        devDependencies: { vitest: "^3.2.4" },
      }),
    );
    writeFileSync(join(directory, "client/package-lock.json"), "{}");

    const coverage = answerOf(directory).tools.find(
      (tool) => tool.name === "@vitest/coverage-v8",
    );

    expect(coverage?.cwd).toBe("client");
    expect(coverage?.command).not.toContain("-w");
  });

  it("gives a workspace member a flag relative to its lockfile root", () => {
    const directory = makeTempDir("recognizer-survey-rel-");
    const vitest = JSON.stringify({
      scripts: { test: "vitest run" },
      devDependencies: { vitest: "^3.2.4" },
    });

    mkdirSync(join(directory, "packages/a"), { recursive: true });
    mkdirSync(join(directory, "web/packages/a"), { recursive: true });
    writeFileSync(join(directory, "package-lock.json"), "{}");
    writeFileSync(join(directory, "packages/a/package.json"), vitest);
    writeFileSync(join(directory, "web/package-lock.json"), "{}");
    writeFileSync(join(directory, "web/packages/a/package.json"), vitest);

    const coverage = answerOf(directory).tools.filter(
      (tool) => tool.name === "@vitest/coverage-v8",
    );
    const at = (cwd: string) => coverage.find((tool) => tool.cwd === cwd);

    expect(at(".")?.command.slice(-2)).toEqual(["-w", "packages/a"]);
    expect(at("web")?.command.slice(-2)).toEqual(["-w", "packages/a"]);
  });

  it("carries the files an install may change and its undo note", () => {
    const directory = makeTempDir("recognizer-survey-undo-");

    mkdirSync(join(directory, "packages/a"), { recursive: true });
    writeFileSync(join(directory, "package-lock.json"), "{}");
    writeFileSync(
      join(directory, "packages/a/package.json"),
      JSON.stringify({
        scripts: { test: "vitest run" },
        devDependencies: { vitest: "^3.2.4" },
      }),
    );

    const [tool] = answerOf(directory).tools;

    expect(tool?.files).toEqual([
      "package.json",
      "package-lock.json",
      "npm-shrinkwrap.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "packages/a/package.json",
    ]);
    expect(tool?.undo_note).toBe(
      "package.json and the lockfile are restored; the package stays in node_modules until the next npm install",
    );
    expect(tool).not.toHaveProperty("undo");
  });

  it("does not answer a runner whose folder a configured suite covers", () => {
    const directory = makeTempDir("recognizer-survey-covered-");

    mkdirSync(join(directory, "web"), { recursive: true });
    writeFileSync(
      join(directory, "web/package.json"),
      JSON.stringify({
        scripts: { test: "vitest run" },
        devDependencies: { vitest: "^3.2.4" },
      }),
    );

    const answer = answerOf(directory, [
      { language: "typescript", directory: "web" },
    ]);

    expect(answer.runners).toEqual([]);
    expect(answer.tools).toEqual([]);
  });

  it("suggests a report path under the repository's root cache for every runner", () => {
    const directory = makeTempDir("recognizer-survey-cache-");
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

    const answer = answerOf(directory);

    expect(directories(answer).sort()).toEqual([
      ".",
      "packages/jt",
      "packages/web",
    ]);

    for (const runner of answer.runners) {
      expect(runner.coverage.path).toBe(
        ".recognizer/cache/coverage/{slug}/lcov.info",
      );
      expect(runner.command).toContain("{up}.recognizer/cache/coverage/{slug}");
    }
  });
});

function chainRepository(
  server: Record<string, unknown>,
  config = true,
): string {
  const directory = makeTempDir("recognizer-survey-chain-");

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
  it("finds a vitest suite behind an npm run chain and carries its env", () => {
    const answer = answerOf(chainRepository(SAGA_SERVER));

    expect(answer.runners).toHaveLength(2);

    const [server, web] = answer.runners;

    expect(server?.env).toEqual({ NODE_CONFIG_DIR: "./config" });
    expect(server?.directory).toBe("server");
    expect(server?.from).toBe("server/package.json");
    expect(server?.command).toBe(
      "npx vitest run --coverage --coverage.reporter=lcov --coverage.reportsDirectory={up}.recognizer/cache/coverage/{slug}",
    );
    expect(web?.directory).toBe("web");
    expect(web).not.toHaveProperty("env");
    expect(
      answer.runners.some((runner) => runner.command.includes("integration")),
    ).toBe(false);
  });

  it("follows nothing without a vitest config beside the package", () => {
    expect(directories(answerOf(chainRepository(SAGA_SERVER, false)))).toEqual([
      "web",
    ]);
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
    (_title, scripts) => {
      expect(
        directories(answerOf(chainRepository({ name: "server", scripts }))),
      ).toEqual(["web"]);
    },
  );

  it("keeps a vitest script's own arguments in the command", () => {
    const directory = chainRepository({
      name: "server",
      scripts: { test: "vitest run --config test/vitest.config.ts" },
    });

    rmSync(join(directory, "server/vitest.config.ts"));
    mkdirSync(join(directory, "server/test"), { recursive: true });
    writeFileSync(join(directory, "server/test/vitest.config.ts"), "");

    const server = answerOf(directory).runners.find(
      (runner) => runner.directory === "server",
    );

    expect(server).toBeDefined();
    expect(server?.command).toBe(
      "npx vitest run --config test/vitest.config.ts --coverage --coverage.reporter=lcov --coverage.reportsDirectory={up}.recognizer/cache/coverage/{slug}",
    );
  });

  it("keeps the arguments of a chain step and its env", () => {
    const server = answerOf(
      chainRepository({
        name: "server",
        scripts: {
          test: "npm run unit",
          unit: "NODE_CONFIG_DIR=./config vitest run --project web",
        },
      }),
    ).runners.find((runner) => runner.directory === "server");

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
  ])("gives no runner for %s without a config beside it", (_title, scripts) => {
    expect(
      directories(
        answerOf(
          chainRepository(
            {
              name: "server",
              scripts,
              devDependencies: { vitest: "^3.2.4" },
            },
            false,
          ),
        ),
      ),
    ).toEqual(["web"]);
  });

  it("a hit and a stop in one survey are each their own result", () => {
    const directory = makeTempDir("recognizer-survey-mixed-");

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

    const answer = answerOf(directory);

    expect(directories(answer)).toEqual(["alpha"]);
    expect(answer.runners[0]?.command).toContain(
      "run --config a.ts --coverage",
    );
  });

  it("the survey of the Saga-shaped fixture lists server and web", () => {
    const answer = answerOf(join(REPO, "fixtures/setup-saga"));

    expect(directories(answer)).toEqual(["server", "web"]);
    expect(answer.runners[0]?.env).toEqual({ NODE_CONFIG_DIR: "./config" });
  });
});

describe("the survey verb", () => {
  it("answers a request file with a valid answer on stdout and exits 0", () => {
    const root = join(REPO, "fixtures/setup-loom");
    const file = join(makeTempDir("recognizer-survey-verb-"), "request.json");

    writeFileSync(
      file,
      JSON.stringify({ root, files: filesUnder(root), suites: [] }),
    );

    const result = spawnSync("node", [BIN, "survey", file], {
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");

    const answer = JSON.parse(result.stdout) as SurveyAnswer;

    expect(validateAnswer(answer), JSON.stringify(validateAnswer.errors)).toBe(
      true,
    );
    expect(answer.runners.map((runner) => runner.from)).toEqual([
      "engine/package.json",
      "app/package.json",
    ]);
  });

  it("exits 2 for a request file that is not there", () => {
    const result = spawnSync("node", [BIN, "survey", "/nonexistent"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
  });
});

describe("against the real committed content", () => {
  it("the loom example puts every runner's report under the root cache", () => {
    const answer = answerOf(join(REPO, "fixtures/setup-loom"));

    expect(answer.runners.map((runner) => runner.from)).toEqual([
      "engine/package.json",
      "app/package.json",
    ]);

    for (const runner of answer.runners) {
      expect(runner.coverage.path).toBe(
        ".recognizer/cache/coverage/{slug}/lcov.info",
      );
      expect(runner.command).toContain(
        "--coverage.reportsDirectory={up}.recognizer/cache/coverage/{slug}",
      );
    }
  });
});
