import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { parseConfig } from "../../src/config-parse.js";
import { REPO } from "../helpers.js";
import { registerShim, useRegisteredShims } from "../plugin-registry-shim.js";

const HAS_UV = spawnSync("uv", ["--version"]).status === 0;
const BIN = join(REPO, "packages/cli/dist/bin.js");

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
  "csharp-solution",
];

function linkTool(directory: string, name: string, target: string): void {
  if (target !== "") {
    symlinkSync(target, join(directory, name));
  }
}

function toolPath(directory: string): string {
  const uv = spawnSync("which", ["uv"], { encoding: "utf8" }).stdout.trim();

  linkTool(directory, "node", process.execPath);
  linkTool(directory, "uv", uv);

  return `${directory}:/usr/bin:/bin`;
}

function launcher(directory: string, name: string, body: string): void {
  const path = join(directory, name);

  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  registerShim(path);
}

if (!HAS_UV) {
  console.warn("skipping the config real-content test: uv is not installed");
}

describe.skipIf(!HAS_UV)(
  "recognizer config with the real sensors package (needs uv)",
  () => {
    let savedPath: string | undefined;
    let restoreRegistry: () => void;
    let launchers: string;
    let sensorsBin: string;

    beforeAll(() => {
      const resolved = spawnSync(
        "uv",
        [
          "run",
          "--quiet",
          "--project",
          join(REPO, "packages/sensors"),
          "python",
          "-c",
          "import sys; print(sys.prefix)",
        ],
        { encoding: "utf8" },
      );

      expect(resolved.status, resolved.stderr).toBe(0);

      sensorsBin = join(resolved.stdout.trim(), "bin");
    }, scaledTimeout(240_000));

    beforeEach(() => {
      savedPath = process.env.PATH;
      launchers = makeTempDir("recognizer-launchers-");
      launcher(
        launchers,
        "recognizer-sense-crap",
        `exec ${sensorsBin}/recognizer-sense-crap "$@"`,
      );
      launcher(
        launchers,
        "recognizer-sense-mutation",
        `exec ${sensorsBin}/recognizer-sense-mutation "$@"`,
      );
      launcher(launchers, "recognizer", `exec node ${BIN} "$@"`);
      restoreRegistry = useRegisteredShims(launchers);
      process.env.PATH = toolPath(launchers);
    });

    afterEach(() => {
      process.env.PATH = savedPath;
      restoreRegistry();
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
      "prints the schema of recognizer config --schema equal to the pinned file, whole",
      () => {
        const pinned = JSON.parse(
          readFileSync(join(REPO, "fixtures/sensors/config-keys.json"), "utf8"),
        );
        const defaulted = pinned.keys.filter(
          (entry: Record<string, unknown>) =>
            entry.default !== undefined ||
            entry.defaults !== undefined ||
            entry.default_text !== undefined,
        );

        expect(defaulted).toHaveLength(6);

        const result = shell("recognizer config --schema", repository());

        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(pinned);
      },
      scaledTimeout(120_000),
    );

    it(
      "reproduces the eleven measured configs by running the guide's own commands",
      () => {
        const guide = shell("recognizer-sense-crap guide", repository());

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
              "crap",
              "mutation",
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
