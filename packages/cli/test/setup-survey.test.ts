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
import type { Survey } from "@recognizer/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import validate from "../src/generated/setup-survey-validator.js";
import { runSetup } from "../src/setup-command.js";
import { capture, REPO } from "./helpers.js";
import { copyLoom, LOOM, shimDirectory, shimmedPath } from "./setup-helpers.js";
import { writeStubSurveyPlugin } from "./stub-survey-plugin.js";

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

function copySaga(config: string | null, describer = false): string {
  const directory = makeTempDir("recognizer-setup-saga-");

  process.env.PATH = shimmedPath(shimDirectory(true, describer, "saga"));

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

  it("the files step counts the scan's modules, not its files", async () => {
    const scan = JSON.parse(readFileSync(join(LOOM, "scan.json"), "utf8")) as {
      files: { path: string; hash: string }[];
      modules: { id: string }[];
    };
    const sources = scan.modules.slice(0, 2).map((module) => module.id);
    const manifest = { path: "package.json", hash: scan.files[0]?.hash ?? "" };
    const bespoke = {
      ...scan,
      files: [
        ...scan.files.filter((file) => sources.includes(file.path)),
        manifest,
      ],
      modules: scan.modules.filter((module) => sources.includes(module.id)),
    };
    const directory = makeTempDir("recognizer-survey-count-");
    const path = join(directory, "scan.json");

    writeFileSync(path, JSON.stringify(bespoke));

    const { survey } = await surveyOf([LOOM, "--scan", path]);
    const typescript = survey.files?.find(
      (one) => one.language === "typescript",
    );

    expect(bespoke.files).toHaveLength(3);
    expect(typescript?.files).toBe(2);
    expect(
      typescript?.folders.reduce((total, folder) => total + folder.files, 0),
    ).toBe(2);
  });

  it("a scan whose files and modules coincide keeps its count", async () => {
    const { survey } = await surveyOf([
      LOOM,
      "--scan",
      join(LOOM, "scan.json"),
    ]);
    const scan = JSON.parse(readFileSync(join(LOOM, "scan.json"), "utf8")) as {
      files: unknown[];
      modules: unknown[];
    };
    const typescript = survey.files?.find(
      (one) => one.language === "typescript",
    );

    expect(scan.files).toHaveLength(scan.modules.length);
    expect(typescript?.files).toBe(scan.modules.length);
  });

  it("leaves an unregistered plugin the Checks step offers out of the fixes", async () => {
    const directory = copySaga("overlays:\n  x: 1\n", true);
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

describe("setup survey gap notes", () => {
  function tree(files: Record<string, string>): string {
    const directory = makeTempDir("recognizer-setup-gap-");

    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, name)), { recursive: true });
      writeFileSync(join(directory, name), text);
    }

    return directory;
  }

  function runner(language: string, from: string): Record<string, unknown> {
    return {
      language,
      runner: language,
      directory: dirname(from),
      from,
      command: `run ${language}`,
      coverage: { path: "c/lcov.info", format: "lcov" },
      tool: null,
    };
  }

  async function surveyWith(
    directory: string,
    answers: { name: string; answer: Record<string, unknown> }[],
  ): Promise<Survey> {
    const shims = makeTempDir("recognizer-setup-gap-shims-");
    const extensions: Record<string, string[]> = {
      python: [".py"],
      rust: [".rs"],
      kotlin: [".kt"],
    };

    for (const [order, { name, answer }] of answers.entries()) {
      writeStubSurveyPlugin(shims, {
        name,
        order,
        extensions: extensions[name] ?? [],
        stdout: JSON.stringify(answer),
      });
    }

    process.env.PATH = shimmedPath(shims);

    return (await surveyOf([directory])).survey;
  }

  it("the largest language with no runner gets a survey note", async () => {
    const python = {
      name: "python",
      answer: {
        runners: [runner("python", "tools/x/requirements-dev.txt")],
        tools: [],
        notes: [],
      },
    };
    const survey = await surveyWith(
      tree({
        "a/A.kt": "",
        "a/B.kt": "",
        "a/C.kt": "",
        "tools/x/t.py": "",
      }),
      [python],
    );
    const gap = survey.notes?.filter((note) => note.language === "kotlin");

    expect(gap).toHaveLength(1);
    expect(gap?.[0]?.text).toContain("kotlin");
    expect(gap?.[0]?.text).toContain("3 files");

    const tie = await surveyWith(
      tree({ "a.kt": "", "b.kt": "", "c.rs": "", "d.rs": "" }),
      [python],
    );

    expect(tie.notes?.map((note) => note.language)).toEqual(["kotlin"]);
  });

  it("no gap note when every language with files has a runner", async () => {
    const survey = await surveyWith(
      tree({ "tools/x/t.py": "", "crates/core/src/lib.rs": "" }),
      [
        {
          name: "python",
          answer: {
            runners: [runner("python", "tools/x/requirements-dev.txt")],
            tools: [],
            notes: [],
          },
        },
        {
          name: "rust",
          answer: {
            runners: [runner("rust", "crates/core/Cargo.toml")],
            tools: [],
            notes: [],
          },
        },
      ],
    );

    expect(
      survey.notes?.some((note) =>
        note.text.includes("is the largest language"),
      ),
    ).toBeFalsy();
  });

  it("a language that already has a note gets no gap note", async () => {
    const survey = await surveyWith(
      tree({ "src/main/kotlin/A.kt": "class A\n" }),
      [
        {
          name: "kotlin",
          answer: {
            runners: [],
            tools: [],
            notes: [
              { language: "kotlin", directory: ".", text: "no JaCoCo: add it" },
            ],
          },
        },
      ],
    );

    expect(survey.notes).toHaveLength(1);
    expect(survey.notes?.[0]?.text).toContain("JaCoCo");
  });
});
