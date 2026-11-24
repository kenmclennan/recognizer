import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildChanges,
  type PlannedChange,
  type SetupChoices,
  type SetupStop,
  type Survey,
} from "../../src/index.js";
import { type ConfigurationWorld, ROOT, worldOf } from "./world.js";

function repositoryRoot(): string {
  let at = dirname(fileURLToPath(import.meta.url));

  while (!existsSync(join(at, "schema/setup-survey-examples"))) {
    at = dirname(at);
  }

  return at;
}

const REPO = repositoryRoot();

export const CONFIG =
  "tests:\n  - name: old\n    language: python\n    directory: .\n    command: pytest\n    coverage:\n      path: coverage/lcov.info\n      format: lcov\n";

export const choices: SetupChoices = {
  analysis: { on: true, limits: { long_function: 30, pair_min_lines: 12 } },
  plugins: ["crap"],
  runners: [{ name: "engine" }, { name: "tauri" }],
  tools: ["@vitest/coverage-v8", "cargo-llvm-cov"],
  policy: [{ kind: "ignore", globs: ["scripts/*"], why: "w", based_on: "b" }],
};

const example = JSON.parse(
  readFileSync(
    join(REPO, "schema/setup-survey-examples/valid/loom.json"),
    "utf8",
  ),
) as Survey;

export function surveyOf(): Survey {
  return {
    ...example,
    repository: ROOT,
    tools: example.tools.map((tool) =>
      tool.kind === "npm"
        ? {
            ...tool,
            files: [
              "package.json",
              "package-lock.json",
              "engine/package.json",
              "app/package.json",
            ],
            undo_note:
              "package.json and the lockfile are restored; the package stays in node_modules until the next npm install",
          }
        : {
            ...tool,
            undo: ["cargo", "uninstall", "cargo-llvm-cov"],
            undo_note: "cargo-llvm-cov was uninstalled",
          },
    ),
  };
}

export function changesFor(
  selected: SetupChoices = choices,
  survey: Survey = surveyOf(),
): PlannedChange[] {
  return buildChanges(survey, selected, "claude").changes;
}

export class ManualStop implements SetupStop {
  flag = false;
  settledCalls = 0;
  private handlers: (() => void)[] = [];

  requested(): boolean {
    return this.flag;
  }

  onRequest(handler: () => void): void {
    this.handlers.push(handler);
  }

  settled(): void {
    this.settledCalls += 1;
  }

  request(): void {
    this.flag = true;

    for (const handler of this.handlers) {
      handler();
    }
  }
}

export interface SetupRunWorld extends ConfigurationWorld {
  started: string[][];
  uninstalled: string[];
  insideCheck: string[];
}

export const READY = {
  ready: true,
  sensors: [{ name: "crap", ready: true, gaps: [] }],
};

export function runWorldOf(
  failAt: ((argv: string[], index: number) => boolean) | null = null,
  check: { ready: boolean; sensors: unknown[] } = READY,
): SetupRunWorld {
  const world = worldOf();
  const { setupFiles, programs } = world.fakes;
  const started: string[][] = [];
  const uninstalled: string[] = [];
  const insideCheck: string[] = [];

  for (const name of ["engine", "app"]) {
    setupFiles.seed(
      `${ROOT}/${name}/package.json`,
      `{"name":"${name}","devDependencies":{"vitest":"^3.2.4"}}\n`,
    );
  }

  setupFiles.seed(`${ROOT}/package.json`, '{"name":"loom"}\n');
  setupFiles.seed(
    `${ROOT}/package-lock.json`,
    '{"lockfileVersion":3,"packages":{}}\n',
  );
  setupFiles.seed(`${ROOT}/.recognizer/config.yaml`, CONFIG);

  const behave = (program: string) =>
    programs.behaviours.set(program, (args, options) => {
      const argv = [program, ...args];
      const index = started.length;

      started.push(argv);

      if (failAt?.(argv, index) === true) {
        return { status: 1, stderr: "boom\n" };
      }

      if (program === "npm") {
        setupFiles.write(
          `${options?.cwd ?? ROOT}/engine/package.json`,
          '{"name":"engine","devDependencies":{"@vitest/coverage-v8":"3.2.4"}}\n',
        );
        setupFiles.write(
          `${options?.cwd ?? ROOT}/package-lock.json`,
          "changed\n",
        );
      }

      if (program === "recognizer" && args[0] === "sensors") {
        insideCheck.push(setupFiles.snapshot());

        return {
          status: check.ready ? 0 : 1,
          stdout: JSON.stringify(check),
        };
      }

      if (program === "recognizer") {
        const config = setupFiles.text(`${ROOT}/.recognizer/config.yaml`) ?? "";

        setupFiles.write(
          `${ROOT}/.recognizer/config.yaml`,
          `${config}# ${args.join(" ")}\n`,
        );
        setupFiles.write(`${ROOT}/.recognizer/policy.yaml`, "ignore: []\n");
      }

      if (program === "cargo" && args[0] === "uninstall") {
        uninstalled.push(args[1] ?? "");
      }

      return {};
    });

  for (const program of ["npm", "cargo", "recognizer"]) {
    behave(program);
  }

  return { ...world, started, uninstalled, insideCheck };
}
