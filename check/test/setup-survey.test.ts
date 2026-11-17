import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import validate from "../src/generated/setup-survey-validator.js";
import { runSetup } from "../src/setup-command.js";
import type { Survey } from "../src/setup-survey.js";
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
