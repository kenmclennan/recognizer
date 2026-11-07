import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { run } from "../src/cli.js";
import { validateScan } from "../src/index.js";
import { capture, REPO } from "./helpers.js";

const VARIABLES = ["RECOGNIZER_SCAN_PYTHON", "RECOGNIZER_SCAN_TYPESCRIPT"];

function launcher(directory: string, name: string, body: string): string {
  const path = join(directory, name);

  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);

  return path;
}

function readScan(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"));
}

function expectedScan(language: string): Record<string, unknown> {
  return readScan(join(REPO, "fixtures", language, "expected-scan.json"));
}

function expectedPythonScan(): Record<string, unknown> {
  const scan = expectedScan("python");

  return {
    ...scan,
    selection: {
      ...(scan.selection as Record<string, unknown>),
      input_absent_paths: ["pyproject.toml", "setup.cfg"],
    },
  };
}

function normalised(scan: Record<string, unknown>): Record<string, unknown> {
  return { ...scan, scanner: null, commit: null };
}

const HAS_UV = spawnSync("uv", ["--version"]).status === 0;
const TYPESCRIPT_BIN = join(REPO, "scanners/typescript/dist/bin.js");

if (!HAS_UV) {
  console.warn("skipping the real-scanner scan tests: uv is not installed");
}

describe.skipIf(!HAS_UV)(
  "recognizer scan with the real scanners (needs uv)",
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
    }, scaledTimeout(120_000));

    let launchers: string;
    let repository: string;
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const name of VARIABLES) {
        saved[name] = process.env[name];
      }

      launchers = mkdtempSync(join(tmpdir(), "recognizer-launchers-"));
      repository = mkdtempSync(join(tmpdir(), "recognizer-scan-repo-"));
      cpSync(join(REPO, "fixtures/python/sample"), repository, {
        recursive: true,
      });
      cpSync(join(REPO, "fixtures/typescript/sample"), repository, {
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
    });

    afterEach(() => {
      for (const name of VARIABLES) {
        if (saved[name] === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = saved[name];
        }
      }

      rmSync(launchers, { recursive: true, force: true });
      rmSync(repository, { recursive: true, force: true });
    });

    it(
      "writes both scans, matches the expected scans, then removes a stale one",
      async () => {
        const first = capture();

        expect(await run(["scan", repository], first.io)).toBe(0);

        const python = join(repository, ".recognizer/cache/scan.python.json");
        const typescript = join(
          repository,
          ".recognizer/cache/scan.typescript.json",
        );

        expect(normalised(readScan(python))).toEqual(
          normalised(expectedPythonScan()),
        );
        expect(normalised(readScan(typescript))).toEqual(
          normalised(expectedScan("typescript")),
        );
        expect(() => validateScan(readScan(python))).not.toThrow();
        expect(() => validateScan(readScan(typescript))).not.toThrow();

        rmSync(join(repository, "shop"), { recursive: true });

        const second = capture();

        expect(await run(["scan", repository], second.io)).toBe(0);
        expect(existsSync(python)).toBe(false);
        expect(existsSync(typescript)).toBe(true);
      },
      scaledTimeout(120_000),
    );

    it(
      "resolves a src-layout package's own imports and matches its expected scan",
      async () => {
        const srcLayout = mkdtempSync(join(tmpdir(), "recognizer-src-layout-"));

        try {
          cpSync(join(REPO, "fixtures/python/src-layout/sample"), srcLayout, {
            recursive: true,
          });

          expect(await run(["scan", srcLayout], capture().io)).toBe(0);
          expect(
            normalised(
              readScan(join(srcLayout, ".recognizer/cache/scan.python.json")),
            ),
          ).toEqual(
            normalised(
              readScan(
                join(REPO, "fixtures/python/src-layout/expected-scan.json"),
              ),
            ),
          );
        } finally {
          rmSync(srcLayout, { recursive: true, force: true });
        }
      },
      scaledTimeout(120_000),
    );

    it(
      "says scans current on a second scan of an unchanged committed repository",
      async () => {
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

        const head = git("rev-parse", "HEAD").stdout.trim();
        const first = capture();
        const second = capture();

        expect(await run(["scan", repository], first.io)).toBe(0);
        expect(first.out()).not.toContain("scans current");
        expect(await run(["scan", repository], second.io)).toBe(0);
        expect(second.out()).toContain(`scans current at ${head}`);
      },
      scaledTimeout(120_000),
    );

    it(
      "records the repository HEAD in both scans",
      async () => {
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

        const head = git("rev-parse", "HEAD").stdout.trim();
        const captured = capture();

        expect(await run(["scan", repository], captured.io)).toBe(0);

        for (const language of ["python", "typescript"]) {
          const path = join(
            repository,
            ".recognizer/cache",
            `scan.${language}.json`,
          );

          expect(readScan(path).commit).toBe(head);
        }
      },
      scaledTimeout(120_000),
    );
  },
);

describe("this repository's own registration", () => {
  it("registers a describer and no sensors, so --sense all is exit 2", async () => {
    const captured = capture();

    expect(await run(["scan", REPO, "--sense", "all"], captured.io)).toBe(2);
    expect(captured.err()).toContain("no sensors are registered");
  });
});
