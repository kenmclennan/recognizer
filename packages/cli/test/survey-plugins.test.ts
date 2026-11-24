import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginAnswer } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { SurveyPluginsAdapter } from "../src/adapters/plugins/survey-plugins-adapter.js";
import { ioWithPath, tempDirectory } from "./plugin-path.js";
import {
  type StubSurveyPlugin,
  writeStubSurveyPlugin,
} from "./stub-survey-plugin.js";

const REQUEST = {
  root: "/repository",
  files: ["a.ts"],
  suites: [{ language: "typescript", directory: "covered" }],
};

function runner(directory: string): Record<string, unknown> {
  return {
    language: "typescript",
    runner: "vitest",
    directory,
    from: `${directory}/package.json`,
    command: "npx vitest run",
    coverage: { path: "c/lcov.info", format: "lcov" },
    tool: null,
  };
}

function answer(...directories: string[]): string {
  return JSON.stringify({
    runners: directories.map(runner),
    tools: [],
    notes: [],
  });
}

function setup(stubs: StubSurveyPlugin[], timeoutMs = scaledTimeout(60_000)) {
  const directory = tempDirectory("recognizer-survey-plugins-");
  const log = join(directory, "requests.log");

  writeFileSync(log, "");

  for (const stub of stubs) {
    writeStubSurveyPlugin(directory, { ...stub, requestLog: log });
  }

  const adapter = new SurveyPluginsAdapter(ioWithPath([directory]), timeoutMs);

  return {
    answers: () => adapter.answers(REQUEST),
    requests: () => readFileSync(log, "utf8"),
  };
}

function failureOf(one: PluginAnswer | undefined): string | null {
  return one !== undefined && "failure" in one ? one.failure : null;
}

describe("SurveyPluginsAdapter", () => {
  it("never asks a scanner that does not declare setup_survey", async () => {
    const directory = tempDirectory("recognizer-survey-plugins-none-");

    writeFileSync(
      join(directory, "recognizer-scan-quiet"),
      "#!/bin/sh\nexit 0\n",
    );

    const adapter = new SurveyPluginsAdapter(ioWithPath([directory]));

    await expect(adapter.answers(REQUEST)).resolves.toEqual([]);
  });

  it("answers each asked scanner with its order and its covered runners left out", async () => {
    const world = setup([
      { name: "one", order: 2, stdout: answer("a", "covered") },
      { name: "two", order: 1, stdout: answer("b") },
    ]);
    const answers = await world.answers();

    expect(answers.map((one) => [one.plugin, one.order])).toEqual(
      expect.arrayContaining([
        ["one", 2],
        ["two", 1],
      ]),
    );

    const one = answers.find((entry) => entry.plugin === "one");

    expect(one !== undefined && "answer" in one).toBe(true);
    expect(
      one !== undefined && "answer" in one
        ? one.answer.runners.map((entry) => entry.directory)
        : [],
    ).toEqual(["a"]);
    expect(world.requests()).toContain('"root":"/repository"');
  });

  it("each plugin receives the file list without the directories its own language skips", async () => {
    const directory = tempDirectory("recognizer-survey-plugins-skip-");
    const rustLog = join(directory, "rust.log");
    const pythonLog = join(directory, "python.log");

    writeFileSync(rustLog, "");
    writeFileSync(pythonLog, "");
    writeStubSurveyPlugin(directory, {
      name: "rust",
      order: 1,
      skip: { directory_names: ["target"] },
      requestLog: rustLog,
    });
    writeStubSurveyPlugin(directory, {
      name: "python",
      order: 2,
      requestLog: pythonLog,
    });

    const adapter = new SurveyPluginsAdapter(
      ioWithPath([directory]),
      scaledTimeout(60_000),
    );

    await adapter.answers({
      root: "/repository",
      files: ["Cargo.toml", "target/Cargo.toml"],
      suites: [],
    });

    const filesOf = (log: string) =>
      (JSON.parse(readFileSync(log, "utf8")) as { files: string[] }).files;

    expect(filesOf(rustLog)).not.toEqual([]);
    expect(filesOf(rustLog)).toEqual(["Cargo.toml"]);
    expect(filesOf(pythonLog)).toEqual(["Cargo.toml", "target/Cargo.toml"]);
  });

  it("turns an exit 1 into a failure for that scanner only", async () => {
    const world = setup([
      { name: "good", order: 1, stdout: answer("a") },
      { name: "bad", order: 2, status: 1 },
    ]);
    const answers = await world.answers();

    expect(failureOf(answers.find((one) => one.plugin === "bad"))).toContain(
      "exited 1",
    );
    expect(failureOf(answers.find((one) => one.plugin === "good"))).toBeNull();
  });

  it.each([
    ["invalid JSON", "{"],
    ["an answer that breaks the schema", '{"runners":"no"}'],
  ])("turns %s into a failure", async (_name, stdout) => {
    const answers = await setup([{ name: "odd", order: 1, stdout }]).answers();

    expect(failureOf(answers[0])).not.toBeNull();
  });

  it("turns a scanner that outlasts the timeout into a failure", async () => {
    const world = setup(
      [{ name: "slow", order: 1, holdSeconds: 30 }],
      scaledTimeout(400),
    );
    const answers = await world.answers();

    expect(failureOf(answers[0])).toBe("it timed out");
  });
});
