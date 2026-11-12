import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { parseConfig } from "../src/config-parse.js";
import { REPO } from "./helpers.js";

const HAS_UV = spawnSync("uv", ["--version"]).status === 0;
const BIN = join(REPO, "check/dist/bin.js");
const GUIDE_RUNS = [
  "python",
  "typescript-vitest",
  "typescript-jest",
  "kotlin",
  "rust",
  "csharp",
  "kotlin-workspace",
  "rust-workspace",
  "rust-crate",
  "typescript-package",
];

function launcher(directory: string, name: string, body: string): void {
  const path = join(directory, name);

  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

describe("the committed .recognizer/config.yaml", () => {
  const text = readFileSync(join(REPO, ".recognizer/config.yaml"), "utf8");

  it.each([["all"], [["describer"]], [["sensors"]], [[]]] as const)(
    "parses with read %j",
    (read) => {
      expect(() => parseConfig(text, read)).not.toThrow();
    },
  );

  it("reads all as the whole-file parse", () => {
    expect(parseConfig(text, "all")).toEqual(parseConfig(text));
  });
});

if (!HAS_UV) {
  console.warn("skipping the config real-content test: uv is not installed");
}

describe.skipIf(!HAS_UV)(
  "recognizer config with the real sensors package (needs uv)",
  () => {
    let savedPath: string | undefined;
    let launchers: string;

    beforeEach(() => {
      savedPath = process.env.PATH;
      launchers = makeTempDir("recognizer-launchers-");
      launcher(
        launchers,
        "recognizer-sensors",
        `exec uv run --quiet --project ${REPO}/sensors recognizer-sensors "$@"`,
      );
      launcher(launchers, "recognizer", `exec node ${BIN} "$@"`);
      process.env.PATH = `${launchers}:${savedPath}`;
    });

    afterEach(() => {
      process.env.PATH = savedPath;
    });

    function shell(command: string, cwd: string) {
      return spawnSync("sh", ["-c", command], {
        cwd,
        encoding: "utf8",
        env: process.env,
      });
    }

    function repository(): string {
      const directory = makeTempDir("recognizer-config-repo-");

      spawnSync("git", ["-C", directory, "init", "-q"]);

      return directory;
    }

    it(
      "lists keys the real package publishes, and exits 0",
      () => {
        const result = shell("recognizer help config", repository());

        expect(result.status).toBe(0);
        expect(result.stdout).toContain("tests.<name>.coverage.format");
        expect(result.stdout).toContain("sensors.mutation.carry");
        expect(result.stdout).not.toContain("did not answer");
      },
      scaledTimeout(120_000),
    );

    it(
      "reproduces the ten measured configs by running the guide's own commands",
      () => {
        const guide = shell("recognizer-sensors crap --guide", repository());

        expect(guide.status).toBe(0);

        const runs: string[][] = [];
        let previous = false;

        for (const line of guide.stdout.split("\n")) {
          const isCommand = line.startsWith("  recognizer config ");

          if (isCommand && !previous) {
            runs.push([]);
          }

          if (isCommand) {
            runs[runs.length - 1]?.push(line.trim());
          }

          previous = isCommand;
        }

        expect(runs.length).toBe(GUIDE_RUNS.length);

        for (const [at, name] of GUIDE_RUNS.entries()) {
          const directory = repository();
          const commands = runs[at] as string[];

          expect(commands.length, name).toBeGreaterThan(0);

          for (const command of commands) {
            const result = shell(command, directory);

            expect(result.status, `${name}: ${command}\n${result.stderr}`).toBe(
              0,
            );
          }

          const written = readFileSync(
            join(directory, ".recognizer/config.yaml"),
            "utf8",
          );
          const expected = readFileSync(
            join(REPO, "fixtures/config-edit/guide", `${name}.yaml`),
            "utf8",
          );
          const got = parseConfig(written);
          const want = parseConfig(expected);

          expect(got, name).toEqual(want);

          if (name === "python") {
            expect(Object.keys(got.sensors ?? {})).toEqual([
              "duplication",
              "crap",
              "mutation",
              "thresholds",
            ]);
          }
        }
      },
      scaledTimeout(240_000),
    );

    it(
      "refuses a wrong enum value in a repository with no config, naming the allowed values, and creates no file",
      () => {
        const directory = repository();
        const result = shell(
          "recognizer config tests.unit.coverage.format foo",
          directory,
        );

        expect(result.status).toBe(2);
        expect(result.stderr).toContain("lcov, jacoco");
        expect(existsSync(join(directory, ".recognizer/config.yaml"))).toBe(
          false,
        );
      },
      scaledTimeout(120_000),
    );
  },
);
