import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { run } from "../src/cli.js";
import { validateFindings } from "../src/findings-document.js";
import { capture, REPO } from "./helpers.js";

const VARIABLES = ["RECOGNIZER_SCAN_PYTHON", "RECOGNIZER_SCAN_TYPESCRIPT"];
const HAS_UV = spawnSync("uv", ["--version"]).status === 0;
const TYPESCRIPT_BIN = join(REPO, "scanners/typescript/dist/bin.js");

function launcher(directory: string, name: string, body: string): string {
  const path = join(directory, name);

  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);

  return path;
}

if (!HAS_UV) {
  console.warn("skipping the sensors integration test: uv is not installed");
}

describe.skipIf(!HAS_UV)(
  "recognizer scan --sense duplication with the real package (needs uv)",
  () => {
    beforeAll(() => {
      if (existsSync(TYPESCRIPT_BIN)) {
        return;
      }

      const build = spawnSync(
        "npm",
        ["run", "build", "-w", "recognizer-scan-typescript"],
        { cwd: REPO, encoding: "utf8" },
      );

      if (build.status !== 0) {
        throw new Error(
          `building the TypeScript scanner failed:\n${build.stdout}\n${build.stderr}`,
        );
      }
    }, 120_000);

    const saved: Record<string, string | undefined> = {};
    let savedPath: string | undefined;
    let repository: string;

    function commit(): void {
      const git = (...args: string[]) =>
        spawnSync("git", ["-C", repository, ...args], {
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "t",
            GIT_AUTHOR_EMAIL: "t@example.com",
            GIT_COMMITTER_NAME: "t",
            GIT_COMMITTER_EMAIL: "t@example.com",
          },
        });

      git("init", "-q");
      git("add", "-A");
      git("commit", "-q", "-m", "init");
    }

    function configure(sensors: string): void {
      mkdirSync(join(repository, ".recognizer"), { recursive: true });
      writeFileSync(
        join(repository, ".recognizer/config.yaml"),
        `sensors:\n  duplication: ${sensors}\n`,
      );
    }

    beforeEach(() => {
      for (const name of VARIABLES) {
        saved[name] = process.env[name];
      }

      savedPath = process.env.PATH;

      const launchers = makeTempDir("recognizer-launchers-");

      repository = makeTempDir("recognizer-sensors-repo-");
      cpSync(join(REPO, "fixtures/duplication/sample"), repository, {
        recursive: true,
      });
      process.env.RECOGNIZER_SCAN_PYTHON = launcher(
        launchers,
        "python.sh",
        `exec uv run --quiet --project ${REPO}/scanners/python recognizer-scan-python "$@"`,
      );
      process.env.RECOGNIZER_SCAN_TYPESCRIPT = launcher(
        launchers,
        "typescript.sh",
        `exec node ${REPO}/scanners/typescript/dist/bin.js "$@"`,
      );
      launcher(
        launchers,
        "recognizer-sensors",
        `exec uv run --quiet --project ${REPO}/sensors recognizer-sensors "$@"`,
      );
      process.env.PATH = `${launchers}:${savedPath}`;
    });

    afterEach(() => {
      for (const name of VARIABLES) {
        if (saved[name] === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = saved[name];
        }
      }

      process.env.PATH = savedPath;
    });

    function findings(): {
      id: string;
      evidence: {
        modules: string[];
        members: { file: string; lines: number[] }[];
      };
    }[] {
      const path = join(
        repository,
        ".recognizer/cache/findings/duplication.json",
      );
      const document = JSON.parse(readFileSync(path, "utf8"));

      expect(() =>
        validateFindings(document, {
          name: "duplication",
          commit: document.commit,
        }),
      ).not.toThrow();

      return document.findings;
    }

    it("finds exactly the two planted duplicates", () => {
      configure("{}");
      commit();

      const captured = capture();

      expect(
        run(["scan", repository, "--sense", "duplication"], captured.io),
      ).toBe(0);

      expect(findings().map((finding) => finding.id)).toEqual([
        "duplication:app/pricing.py::sum_with_levy|app/pricing.py::total_with_tax",
        "duplication:src/pricing.ts::sumWithLevy|src/pricing.ts::totalWithTax",
      ]);

      const [python, typescript] = findings();

      expect(python?.evidence.modules).toEqual(["app/pricing.py"]);
      expect(python?.evidence.members.map((m) => [m.file, m.lines])).toEqual([
        ["app/pricing.py", [10, 16]],
        ["app/pricing.py", [1, 7]],
      ]);
      expect(typescript?.evidence.modules).toEqual(["src/pricing.ts"]);
      expect(
        typescript?.evidence.members.map((m) => [m.file, m.lines]),
      ).toEqual([
        ["src/pricing.ts", [12, 21]],
        ["src/pricing.ts", [1, 10]],
      ]);
    }, 180_000);

    it("passes the settings to the sensor", () => {
      configure("{threshold: 0.99}");
      commit();

      expect(
        run(["scan", repository, "--sense", "duplication"], capture().io),
      ).toBe(0);
      expect(findings()).toHaveLength(2);
    }, 180_000);

    it("refuses a threshold above 1 when the config is read", () => {
      configure("{threshold: 1.01}");
      commit();

      const captured = capture();

      expect(
        run(["scan", repository, "--sense", "duplication"], captured.io),
      ).not.toBe(0);
      expect(captured.err()).toContain("config/sensors/duplication");
    }, 180_000);
  },
);
