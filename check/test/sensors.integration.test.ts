import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { run } from "../src/cli.js";
import { validateFindings } from "../src/findings-document.js";
import { entriesOf } from "../src/run-log.js";
import { capture, REPO } from "./helpers.js";

const VARIABLES = [
  "RECOGNIZER_SCAN_PYTHON",
  "RECOGNIZER_SCAN_TYPESCRIPT",
  "SHELL",
];
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
  "recognizer scan with the real sensors package (needs uv)",
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
        `sensors:\n  structure:\n    duplication: ${sensors}\n`,
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
      launcher(
        launchers,
        "recognizer-sense-crap",
        `exec uv run --quiet --project ${REPO}/sensors recognizer-sense-crap "$@"`,
      );
      launcher(
        launchers,
        "recognizer-sense-mutation",
        `exec uv run --quiet --project ${REPO}/sensors recognizer-sense-mutation "$@"`,
      );
      launcher(
        launchers,
        "recognizer-sense-thresholds",
        `exec uv run --quiet --project ${REPO}/sensors recognizer-sense-thresholds "$@"`,
      );
      process.env.SHELL = launcher(
        launchers,
        "shell.sh",
        [
          'case "$2" in',
          '  *"recognizer-check: start"*) echo "recognizer-check: start"; exit 0;;',
          "esac",
          'exec sh -c "$2"',
        ].join("\n"),
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
        ".recognizer/cache/findings/structure.json",
      );
      const document = JSON.parse(readFileSync(path, "utf8"));

      expect(() =>
        validateFindings(document, {
          name: "structure",
          commit: document.commit,
        }),
      ).not.toThrow();

      expect(document.findings_version).toBe(2);
      expect(document.tests).toBeUndefined();

      const scanned = new Map<string, string>();

      for (const language of ["python", "typescript"]) {
        const scan = JSON.parse(
          readFileSync(
            join(repository, `.recognizer/cache/scan.${language}.json`),
            "utf8",
          ),
        );

        for (const file of scan.files) {
          scanned.set(file.path, file.hash);
        }
      }

      expect(Object.keys(document.inputs)).toEqual(
        expect.arrayContaining(["app/pricing.py", "src/pricing.ts"]),
      );

      for (const [module, hash] of Object.entries(document.inputs)) {
        expect(hash).toBe(scanned.get(module));
      }

      return document.findings.filter(
        (finding: { kind: string }) => finding.kind === "duplication",
      );
    }

    it(
      "finds exactly the two planted duplicates",
      async () => {
        configure("{}");
        commit();

        const captured = capture();

        expect(await run(["scan", repository], captured.io)).toBe(0);

        expect(findings().map((finding) => finding.id)).toEqual([
          "duplication:src/pricing.ts::sumWithLevy|src/pricing.ts::totalWithTax",
          "duplication:app/pricing.py::sum_with_levy|app/pricing.py::total_with_tax",
        ]);

        const [typescript, python] = findings();

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
      },
      scaledTimeout(180_000),
    );

    it(
      "stops naming a copy that was only on disk during a dirty run",
      async () => {
        configure("{}");
        commit();

        const copy = join(repository, "app/pricing_copy.py");

        cpSync(join(repository, "app/pricing.py"), copy);

        expect(await run(["scan", repository], capture().io)).toBe(0);
        expect(JSON.stringify(findings())).toContain("pricing_copy.py");

        rmSync(copy);

        const captured = capture();

        expect(
          await run(
            ["check", "--repository", repository, "--json"],
            captured.io,
          ),
        ).toBeLessThan(2);
        expect(captured.out()).not.toContain("pricing_copy.py");
        expect(captured.err()).toContain(
          "duplication not measured since the last scan",
        );
      },
      scaledTimeout(180_000),
    );

    it(
      "passes the settings to the sensor",
      async () => {
        configure("{threshold: 0.99}");
        commit();

        expect(await run(["scan", repository], capture().io)).toBe(0);
        expect(findings()).toHaveLength(2);

        const stored = JSON.parse(
          readFileSync(
            join(repository, ".recognizer/cache/findings/structure.json"),
            "utf8",
          ),
        );

        expect(stored.settings.duplication.threshold).toBe(0.99);
      },
      scaledTimeout(180_000),
    );

    it(
      "refuses a threshold above 1 when the config is read",
      async () => {
        configure("{threshold: 1.01}");
        commit();

        const captured = capture();

        expect(await run(["scan", repository], captured.io)).not.toBe(0);
        expect(captured.err()).toContain(
          "config/sensors/structure/duplication/threshold must be above 0 and at most 1",
        );
      },
      scaledTimeout(180_000),
    );

    function crapOverlay(): {
      values: Record<string, Record<string, number>>;
      inputs: Record<string, string>;
      tests: string;
    } {
      return JSON.parse(
        readFileSync(
          join(repository, ".recognizer/cache/overlays/crap.json"),
          "utf8",
        ),
      );
    }

    const CRAP_SUITES = [
      "tests:",
      "  - name: sample",
      "    language: python",
      "    directory: .",
      "    command: touch coverage/lcov.info",
      "    coverage: {path: coverage/lcov.info, format: lcov}",
      "  - name: sample-web",
      "    language: typescript",
      "    directory: .",
      "    command: touch coverage/lcov.info",
      "    runner: vitest",
      "    coverage: {path: coverage/lcov.info, format: lcov}",
      "",
    ].join("\n");

    function useCrapFixture(sensors: string, suites = CRAP_SUITES): void {
      rmSync(repository, { recursive: true, force: true });
      mkdirSync(repository, { recursive: true });
      cpSync(join(REPO, "fixtures/crap/sample"), repository, {
        recursive: true,
      });
      mkdirSync(join(repository, ".recognizer"), { recursive: true });
      writeFileSync(
        join(repository, ".recognizer/config.yaml"),
        `${suites}sensors:\n  crap: ${sensors}\n`,
      );
      commit();
    }

    it(
      "finds the two planted risks and writes the overlay for crap",
      async () => {
        useCrapFixture("{}");

        expect(
          await run(["scan", repository, "--sense", "crap"], capture().io),
        ).toBe(0);

        const document = JSON.parse(
          readFileSync(
            join(repository, ".recognizer/cache/findings/crap.json"),
            "utf8",
          ),
        );

        expect(() =>
          validateFindings(document, { name: "crap", commit: document.commit }),
        ).not.toThrow();
        expect(document.findings.map((f: { id: string }) => f.id)).toEqual([
          "crap:app/risk.py::classify",
        ]);

        const overlay = crapOverlay();

        expect(overlay.values.complexity?.["app/risk.py::classify"]).toBe(8);
        expect(overlay.values.coverage?.["app/risk.py::classify"]).toBe(0.1818);
        expect(overlay.values.crap?.["app/risk.py::classify"]).toBe(43.053);
        expect(Object.keys(overlay.values.complexity ?? {})).toHaveLength(7);
        expect(Object.keys(overlay.values.coverage ?? {})).toHaveLength(6);
        expect(overlay.values.coverage?.["src/other.ts::pick"]).toBeUndefined();

        const scanned = new Map<string, string>();

        for (const language of ["python", "typescript"]) {
          const scan = JSON.parse(
            readFileSync(
              join(repository, `.recognizer/cache/scan.${language}.json`),
              "utf8",
            ),
          );

          for (const file of scan.files) {
            scanned.set(file.path, file.hash);
          }
        }

        expect(Object.keys(overlay.inputs).length).toBeGreaterThan(0);

        for (const [module, hash] of Object.entries(overlay.inputs)) {
          expect(hash).toBe(scanned.get(module));
        }

        expect(document.findings_version).toBe(2);
        expect(document.inputs).toEqual(overlay.inputs);
        expect(document.tests).toBe(overlay.tests);
        expect(overlay.tests).toMatch(/^[0-9a-f]{64}$/);
      },
      scaledTimeout(180_000),
    );

    it(
      "runs only the ticked suite and keeps the other suite's earlier result",
      async () => {
        useCrapFixture(
          "{}",
          CRAP_SUITES.replace(
            "command: touch coverage/lcov.info\n    coverage: {path: coverage/lcov.info, format: lcov}\n  - name: sample-web",
            "command: touch coverage/lcov.info coverage/ran-sample\n    coverage: {path: coverage/lcov.info, format: lcov}\n  - name: sample-web",
          ).replace(
            "command: touch coverage/lcov.info\n    runner",
            "command: touch coverage/lcov.info coverage/ran-web\n    runner",
          ),
        );

        const suitesOf = (): {
          name: string;
          status: string;
          ran_at: string | null;
          ran?: boolean;
        }[] =>
          JSON.parse(
            readFileSync(
              join(repository, ".recognizer/cache/findings/crap.json"),
              "utf8",
            ),
          ).suites;
        const ranSample = join(repository, "coverage/ran-sample");
        const ranWeb = join(repository, "coverage/ran-web");

        expect(
          await run(["scan", repository, "--sense", "crap"], capture().io),
        ).toBe(0);
        expect(existsSync(ranSample)).toBe(true);
        expect(existsSync(ranWeb)).toBe(true);

        const first = suitesOf();

        rmSync(ranSample);
        rmSync(ranWeb);

        const selection = join(repository, "crap-suites.json");

        writeFileSync(selection, JSON.stringify({ crap: ["sample"] }));

        expect(
          await run(
            ["scan", repository, "--sense", "crap", "--suites", selection],
            capture().io,
          ),
        ).toBe(0);
        expect(existsSync(ranSample)).toBe(true);
        expect(existsSync(ranWeb)).toBe(false);

        const second = suitesOf();

        expect(second.map((one) => one.name)).toEqual(["sample", "sample-web"]);
        expect({ ...second[1], ran: undefined }).toEqual({
          ...first[1],
          ran: undefined,
        });
        expect(first.map((one) => one.ran)).toEqual([true, true]);
        expect(second.map((one) => one.ran)).toEqual([true, false]);
        expect(second[0]?.status).toBe("ok");
      },
      scaledTimeout(180_000),
    );

    it(
      "fails with one sentence and writes nothing when no test suites are configured",
      async () => {
        useCrapFixture("{}", "");

        const captured = capture();

        expect(
          await run(["scan", repository, "--sense", "crap"], captured.io),
        ).toBe(4);
        expect(captured.err()).toContain(
          "no test suites are configured in .recognizer/config.yaml (crap): recognizer help sensors crap",
        );
        expect(
          existsSync(join(repository, ".recognizer/cache/overlays/crap.json")),
        ).toBe(false);
        expect(
          existsSync(join(repository, ".recognizer/cache/findings/crap.json")),
        ).toBe(false);
      },
      scaledTimeout(180_000),
    );

    describe("thresholds on the committed fixture", () => {
      const COMMIT_ENV = {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      };

      function useThresholdsFixture(settings: string): void {
        rmSync(repository, { recursive: true, force: true });
        mkdirSync(repository, { recursive: true });
        cpSync(
          join(REPO, "fixtures/thresholds/sample/app"),
          join(repository, "app"),
          {
            recursive: true,
          },
        );
        cpSync(
          join(REPO, "fixtures/thresholds/sample/src"),
          join(repository, "src"),
          {
            recursive: true,
          },
        );
        commit();

        const head = spawnSync("git", ["-C", repository, "rev-parse", "HEAD"], {
          encoding: "utf8",
          env: COMMIT_ENV,
        }).stdout.trim();
        const overlays = join(repository, ".recognizer/cache/overlays");

        mkdirSync(overlays, { recursive: true });
        writeFileSync(
          join(overlays, "quality.json"),
          readFileSync(
            join(REPO, "fixtures/thresholds/sample/overlays/quality.json"),
            "utf8",
          ).replace("COMMIT", head),
        );
        cpSync(
          join(REPO, "fixtures/thresholds/sample/overlays/stale.json"),
          join(overlays, "stale.json"),
        );
        writeFileSync(
          join(repository, ".recognizer/config.yaml"),
          `sensors:\n  thresholds: ${settings}\n`,
        );
      }

      function thresholdIds(): string[] {
        const document = JSON.parse(
          readFileSync(
            join(repository, ".recognizer/cache/findings/thresholds.json"),
            "utf8",
          ),
        );

        expect(() =>
          validateFindings(document, {
            name: "thresholds",
            commit: document.commit,
          }),
        ).not.toThrow();

        return document.findings.map((f: { id: string }) => f.id);
      }

      it(
        "finds the five planted crossings",
        async () => {
          useThresholdsFixture("{churn: {above: 20, severity: violation}}");

          expect(
            await run(
              ["scan", repository, "--sense", "thresholds"],
              capture().io,
            ),
          ).toBe(0);
          expect(thresholdIds()).toEqual([
            "thresholds:churn:app/billing.py",
            "thresholds:complexity:app/billing.py::price",
            "thresholds:complexity:src/cart.ts::Cart.total",
            "thresholds:coverage:app/billing.py::price",
            "thresholds:coverage:app/billing.py::tidy",
          ]);
        },
        scaledTimeout(180_000),
      );

      it.each(["{complexity: {above: 15}}", "{complexity: off}"])(
        "drops the complexity findings for %s",
        async (settings) => {
          useThresholdsFixture(settings);

          expect(
            await run(
              ["scan", repository, "--sense", "thresholds"],
              capture().io,
            ),
          ).toBe(0);

          const ids = thresholdIds();

          expect(
            ids.filter((id) => id.startsWith("thresholds:complexity:")),
          ).toEqual([]);
          expect(
            ids.filter((id) => id.startsWith("thresholds:coverage:")),
          ).toHaveLength(2);
        },
        scaledTimeout(180_000),
      );
    });
  },
);

describe.skipIf(!HAS_UV)(
  "recognizer scan --json --sense mutation reports progress (needs uv)",
  () => {
    const saved: Record<string, string | undefined> = {};
    let savedPath: string | undefined;
    let repository: string;

    beforeEach(() => {
      saved.RECOGNIZER_SCAN_PYTHON = process.env.RECOGNIZER_SCAN_PYTHON;
      savedPath = process.env.PATH;

      const launchers = makeTempDir("recognizer-launchers-");

      repository = makeTempDir("recognizer-mutation-repo-");
      cpSync(join(REPO, "fixtures/mutation/sample"), repository, {
        recursive: true,
      });
      rmSync(join(repository, "scan.python.json"), { force: true });
      mkdirSync(join(repository, ".recognizer"), { recursive: true });
      writeFileSync(
        join(repository, ".recognizer/config.yaml"),
        [
          "tests:",
          "  - name: sample",
          "    language: python",
          "    directory: .",
          "    activate: 'pytest() { python3 tests/strong.py \"$@\"; }'",
          "    command: 'touch coverage/lcov.info #'",
          "    coverage: {path: coverage/lcov.info, format: lcov}",
          "sensors:",
          "  mutation: {max_workers: 1}",
          "",
        ].join("\n"),
      );
      process.env.RECOGNIZER_SCAN_PYTHON = launcher(
        launchers,
        "python.sh",
        `exec uv run --quiet --project ${REPO}/scanners/python recognizer-scan-python "$@"`,
      );
      launcher(
        launchers,
        "recognizer-sensors",
        `exec uv run --quiet --project ${REPO}/sensors recognizer-sensors "$@"`,
      );
      launcher(
        launchers,
        "recognizer-sense-crap",
        `exec uv run --quiet --project ${REPO}/sensors recognizer-sense-crap "$@"`,
      );
      launcher(
        launchers,
        "recognizer-sense-mutation",
        `exec uv run --quiet --project ${REPO}/sensors recognizer-sense-mutation "$@"`,
      );
      launcher(
        launchers,
        "recognizer-sense-thresholds",
        `exec uv run --quiet --project ${REPO}/sensors recognizer-sense-thresholds "$@"`,
      );
      process.env.PATH = `${launchers}:${savedPath}`;

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
    });

    afterEach(() => {
      if (saved.RECOGNIZER_SCAN_PYTHON === undefined) {
        delete process.env.RECOGNIZER_SCAN_PYTHON;
      } else {
        process.env.RECOGNIZER_SCAN_PYTHON = saved.RECOGNIZER_SCAN_PYTHON;
      }

      process.env.PATH = savedPath;
    });

    it(
      "writes a coverage line then mutants lines ending with every function done",
      async () => {
        const captured = capture();

        expect(
          await run(
            ["scan", repository, "--sense", "mutation", "--json"],
            captured.io,
          ),
        ).toBe(0);

        const events = captured
          .out()
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line));
        const names = events.map((event) => event.event);
        const plugin = events.filter(
          (event) => event.event === "plugin" && event.phase === "sense",
        );
        const data = plugin.map((event) => event.data);
        const progress = data.filter((event) => event.event === "progress");
        const start = data.find((event) => event.event === "start");

        expect(plugin.every((event) => event.name === "mutation")).toBe(true);
        expect(plugin.every((event) => event.phase === "sense")).toBe(true);
        expect(names.indexOf("start")).toBeLessThan(events.indexOf(plugin[0]));
        expect(events.lastIndexOf(plugin.at(-1))).toBeLessThan(
          names.indexOf("entry", names.indexOf("start")),
        );
        expect(data[0]).toEqual({
          event: "note",
          text: "Coverage run: sample",
        });
        expect(start).toMatchObject({ event: "start", unit: "functions" });

        const overlay = JSON.parse(
          readFileSync(
            join(repository, ".recognizer/cache/overlays/mutation.json"),
            "utf8",
          ),
        );
        const mutated = Object.keys(overlay.values.killed).length;

        expect(progress.length).toBeGreaterThan(0);
        expect(progress.every((event) => event.unit === "functions")).toBe(
          true,
        );
        expect(progress.at(-1)).toMatchObject({
          done: mutated,
          total: mutated,
        });
        expect(JSON.stringify(events)).not.toContain('"step":"mutants"');
        expect(captured.out()).not.toContain("recognizer-progress");

        const logDirectory = join(repository, ".recognizer/cache/log");
        const newest = readdirSync(logDirectory)
          .filter((file) => file.endsWith("-scan.json"))
          .sort()
          .at(-1) as string;
        const record = JSON.parse(
          readFileSync(join(logDirectory, newest), "utf8"),
        );
        const mutation = entriesOf(record).find(
          (entry) => entry.name === "mutation",
        );

        expect(mutation).toBeDefined();
        expect(mutation?.outcome).toBe("ok");
        expect(mutation).not.toHaveProperty("incomplete");
      },
      scaledTimeout(240_000),
    );
  },
);

describe.skipIf(!HAS_UV)(
  "recognizer sensors check --run then doctor leave the tree clean (needs uv)",
  () => {
    const saved: Record<string, string | undefined> = {};
    let savedPath: string | undefined;
    let repository: string;

    function git(...args: string[]) {
      return spawnSync("git", ["-C", repository, ...args], {
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@example.com",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.com",
        },
      });
    }

    beforeEach(() => {
      for (const name of VARIABLES) {
        saved[name] = process.env[name];
      }

      savedPath = process.env.PATH;

      const launchers = makeTempDir("recognizer-launchers-");

      repository = makeTempDir("recognizer-clean-repo-");
      cpSync(join(REPO, "fixtures/skill-eval/repo"), repository, {
        recursive: true,
      });
      mkdirSync(join(repository, ".recognizer"), { recursive: true });
      writeFileSync(
        join(repository, ".recognizer/config.yaml"),
        [
          "sensors:",
          "  crap: {}",
          "tests:",
          "  - name: api",
          "    language: python",
          "    directory: .",
          '    command: \'mkdir -p "$(dirname "$COVERAGE_FILE")" .recognizer/cache/coverage/api && : > "$COVERAGE_FILE" && mkdir -p "$PYTHONPYCACHEPREFIX" && : > "$PYTHONPYCACHEPREFIX/x.pyc" && printf "SF:src/shop/domain/order.py\\nDA:1,1\\nend_of_record\\n" > .recognizer/cache/coverage/api/lcov.info\'',
          "    coverage:",
          "      path: .recognizer/cache/coverage/api/lcov.info",
          "      format: lcov",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(repository, ".gitignore"),
        ".venv/\n__pycache__/\n.recognizer/cache/\n",
      );
      process.env.RECOGNIZER_SCAN_PYTHON = launcher(
        launchers,
        "python.sh",
        `exec uv run --quiet --project ${REPO}/scanners/python recognizer-scan-python "$@"`,
      );
      launcher(
        launchers,
        "recognizer-sensors",
        `exec uv run --quiet --project ${REPO}/sensors recognizer-sensors "$@"`,
      );
      launcher(
        launchers,
        "recognizer-sense-crap",
        `exec uv run --quiet --project ${REPO}/sensors recognizer-sense-crap "$@"`,
      );
      launcher(
        launchers,
        "recognizer-sense-mutation",
        `exec uv run --quiet --project ${REPO}/sensors recognizer-sense-mutation "$@"`,
      );
      launcher(
        launchers,
        "recognizer-sense-thresholds",
        `exec uv run --quiet --project ${REPO}/sensors recognizer-sense-thresholds "$@"`,
      );
      launcher(launchers, "python", "exit 0");
      process.env.SHELL = launcher(
        launchers,
        "shell.sh",
        [
          'case "$2" in',
          '  *"recognizer-check: start"*) echo "recognizer-check: start"; exit 0;;',
          "esac",
          'exec sh -c "$2"',
        ].join("\n"),
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

    it(
      "reports no stale scan after the suite ran",
      async () => {
        git("init", "-q");
        git("add", "-A");
        git("commit", "-q", "-m", "init");

        expect(await run(["scan", repository], capture().io)).toBe(0);

        const checked = capture();

        await run(
          ["sensors", "check", "--run", "--repository", repository],
          checked.io,
        );

        expect(
          existsSync(
            join(repository, ".recognizer/cache/coverage/api/lcov.info"),
          ),
        ).toBe(true);
        expect(git("status", "--porcelain").stdout).toBe("");

        const doctor = capture();

        await run(["doctor", repository, "--json"], doctor.io);

        expect(doctor.out()).not.toContain("scan-stale");
      },
      scaledTimeout(240_000),
    );
  },
);
