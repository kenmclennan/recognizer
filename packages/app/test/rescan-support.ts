import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Program,
  type SensorScript,
  sensorManifest,
  sensorProgram,
  TYPESCRIPT_SAMPLE,
} from "../../cli/test/support/index";
import { describerManifestText } from "../../cli/test/support/manifest-text";
import { untilHolds } from "./app-harness";
import type { inProcessAppRoot } from "./in-process-root";

type Root = Awaited<ReturnType<typeof inProcessAppRoot>>;

export type SuiteScript = { name: string; language: string }[];

export type SensorsScript = Record<
  string,
  SensorScript & { runsTests?: boolean; suites?: SuiteScript }
>;

const SUITE_KEYS = {
  section: {
    key: "tests.<name>",
    shape: "list-entry",
    identity: "name",
    description: "one test suite",
    example: 'tests.unit.command "pytest"',
  },
  keys: [
    {
      key: "tests.<name>.language",
      type: "enum",
      description: "the language of the suite",
      example: "tests.unit.language python",
      values: ["python", "typescript"],
      label: "Language",
    },
  ],
};

function manifestFor(name: string, runsTests: boolean): string {
  const manifest = JSON.parse(sensorManifest(name));

  manifest.display = name.charAt(0).toUpperCase() + name.slice(1);
  manifest.runs_tests = runsTests;

  if (runsTests) {
    manifest.suite_keys = SUITE_KEYS;
    manifest.planned_work = { verb: "mutate" };
  }

  return JSON.stringify(manifest);
}

export function sensorsOf(scripts: SensorsScript): {
  config: string;
  programs: Record<string, Program>;
} {
  const programs: Record<string, Program> = {};
  const lines = ["sensors:"];
  const declared = new Map<string, string>();

  for (const [name, script] of Object.entries(scripts)) {
    const { runsTests = false, suites = [], ...rest } = script;
    const base = sensorProgram(name, rest);

    lines.push(
      `  ${name}:`,
      `    manifest: [recognizer-sense-${name}, manifest]`,
    );

    for (const suite of suites) {
      if (!declared.has(suite.name)) {
        declared.set(suite.name, suite.language);
      }
    }

    programs[`recognizer-sense-${name}`] = (call) => {
      if (call.args[0] === "manifest") {
        return {
          started: true,
          status: 0,
          stdout: manifestFor(name, runsTests),
          stderr: "",
        };
      }

      return base(call);
    };
  }

  const tests =
    declared.size === 0
      ? []
      : [
          "tests:",
          ...[...declared].flatMap(([name, language]) => [
            `  - name: ${name}`,
            `    language: ${language}`,
            "    directory: .",
            "    command: pytest",
            "    coverage: { path: coverage/lcov.info, format: lcov }",
          ]),
        ];

  return { config: `${[...tests, ...lines].join("\n")}\n`, programs };
}

export async function afterOpen(root: Root): Promise<number> {
  await untilHolds(root.service, () => root.view.explorer() ?? undefined);
  await untilHolds(root.service, () =>
    root.view.explorer()?.host.running() === false ? true : undefined,
  );

  return root.service.started.length;
}

export async function settledRun(root: Root, since: number): Promise<void> {
  await untilHolds(root.service, () =>
    root.service.started.length > since ? true : undefined,
  );
  await untilHolds(root.service, () =>
    root.view.explorer()?.host.running() === false ? true : undefined,
  );
}

export const DESCRIBER_CONFIG =
  "describer:\n  command: [describer, run, '--model', '{model}', '{request}']\n  version: v1\n";

export function describerProgram(
  hold: { wait(): Promise<void> } | null = null,
): Program {
  const done = { started: true, status: 0, stderr: "" };

  return (call) => {
    if (call.args.at(-1) === "manifest") {
      return { ...done, stdout: describerManifestText("v1") };
    }

    if (call.args[0] === "run") {
      return (async () => {
        await Promise.race([hold?.wait(), call.whenKilled()]);

        return { ...done, stdout: "Does a thing.\n" };
      })();
    }

    return { ...done, stdout: "1\n" };
  };
}

export function sampleFiles(): Record<string, string> {
  const found: Record<string, string> = {};
  const walk = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules") {
        continue;
      }

      if (entry.isDirectory()) {
        walk(join(directory, entry.name), `${prefix}${entry.name}/`);
      } else {
        found[`${prefix}${entry.name}`] = readFileSync(
          join(directory, entry.name),
          "utf8",
        );
      }
    }
  };

  walk(TYPESCRIPT_SAMPLE, "");

  return found;
}
