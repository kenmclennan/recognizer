import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { COMMANDS } from "../src/commands.js";
import { buildChanges, type SetupChoices } from "../src/setup-changes.js";
import type { Survey } from "../src/setup-survey.js";
import { capture, REPO } from "./helpers.js";

const survey = JSON.parse(
  readFileSync(
    join(REPO, "schema/setup-survey-examples/valid/loom.json"),
    "utf8",
  ),
) as Survey;

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
    { kind: "entry", paths: ["app/src/main.ts"], why: "w", based_on: "b" },
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
      "tool-@vitest/coverage-v8",
      "tool-cargo-llvm-cov",
      "tests-engine",
      "tests-app",
      "tests-tauri",
      "plugin-crap",
      "plugin-mutation",
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

  it("builds a runner as one config command per key, with env added inline", () => {
    const { changes } = buildChanges(survey, all);
    const app = changes.find((change) => change.id === "tests-app");

    expect(app?.steps.map((step) => step.argv.slice(2, 4).join(" "))).toEqual([
      "tests.app.language typescript",
      "tests.app.directory app",
      expect.stringContaining("tests.app.command"),
      "tests.app.runner vitest",
      "tests.app.env.NODE_ENV test",
      "tests.app.coverage.path coverage/lcov.info",
      "tests.app.coverage.format lcov",
    ]);

    const tauri = changes.find((change) => change.id === "tests-tauri");

    expect(tauri?.steps.some((step) => step.argv[2]?.endsWith(".runner"))).toBe(
      false,
    );
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

  it("applies an upgrade fix and lists one that needs the user", () => {
    const withUpgrade: Survey = {
      ...survey,
      upgrade: [
        {
          code: "config-retired",
          subject: "sensors.x",
          line: "retired",
          command: "recognizer config --unset sensors.x",
        },
        {
          code: "config-empty",
          subject: "sensors.y",
          line: "empty",
          command: "rm -rf /",
        },
      ],
    };
    const built = buildChanges(withUpgrade, {
      upgrade: [
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
});

describe("the built commands", () => {
  let directory: string;
  let savedPath: string | undefined;

  beforeEach(() => {
    savedPath = process.env.PATH;
    directory = makeTempDir("recognizer-setup-keys-");
    cpSync(join(REPO, "fixtures/setup-loom"), directory, { recursive: true });
  });

  afterEach(() => {
    process.env.PATH = savedPath;
  });

  it("every built command passes the CLI's own key schema", async () => {
    const { changes } = buildChanges({ ...survey, repository: directory }, all);
    const keyed = changes
      .flatMap((change) => change.steps)
      .filter(({ argv }) => argv[1] === "config" || argv[1] === "policy");

    expect(keyed.length).toBeGreaterThan(15);

    for (const { argv } of keyed) {
      const out = capture();
      const command = COMMANDS.find((one) => one.name === argv[1]);
      const status = await command?.run(
        [...argv.slice(2), "--repository", directory],
        out.io,
      );

      expect(status, `${argv.join(" ")}: ${out.err()}`).toBe(0);
    }
  });
});
