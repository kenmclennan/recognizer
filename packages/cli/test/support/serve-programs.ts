import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FakeFiles } from "./io/files.js";
import type { Program } from "./io/processes.js";
import { typescriptScanner } from "./scanner-program.js";
import { Gate } from "./sensor-program.js";

const ROOT = join(__dirname, "../../../..");

const LANGUAGES = JSON.parse(
  readFileSync(join(ROOT, "fixtures/plugins/languages.json"), "utf8"),
) as { name: string }[];

export const LANGUAGE_NAMES = [
  "python",
  "typescript",
  "kotlin",
  "rust",
  "csharp",
];

function manifestText(language: string, reportsTests: boolean): string {
  const base = JSON.parse(
    readFileSync(
      join(ROOT, "schema/manifest-examples/valid/scanner.json"),
      "utf8",
    ),
  );

  return JSON.stringify({
    ...base,
    name: language,
    protocol: 4,
    ...(reportsTests ? { reports_tests: true } : {}),
    languages: [LANGUAGES.find((rule) => rule.name === language)],
  });
}

export interface LanguageScannerOptions {
  entries?: unknown;
  status?: number;
}

export function languageScanner(
  language: string,
  options: LanguageScannerOptions = {},
): Program {
  return (call) => {
    const [verb] = call.args;
    const done = { started: true, status: 0, stderr: "" };

    if (verb === "manifest") {
      return {
        ...done,
        stdout: `${manifestText(language, options.entries !== undefined)}\n`,
      };
    }

    if (verb === "tests") {
      return {
        started: true,
        status: options.status ?? 0,
        stdout: JSON.stringify({ entries: options.entries ?? {} }),
        stderr: "",
      };
    }

    return { ...done, stdout: "" };
  };
}

export function languagePrograms(
  options: LanguageScannerOptions & { tests?: string } = {},
): Record<string, Program> {
  const programs: Record<string, Program> = {};

  for (const language of LANGUAGE_NAMES) {
    programs[`recognizer-scan-${language}`] = languageScanner(
      language,
      language === options.tests || options.tests === undefined ? options : {},
    );
  }

  return programs;
}

export interface RunRecord {
  repository: string;
  output: string;
  killed: boolean;
}

export function holdingScanner(
  options: { fails?: boolean; held?: boolean } = {},
) {
  const gate = new Gate();
  const runs = new Map<string, RunRecord>();

  if (options.held !== false) {
    gate.hold();
  }

  const program = typescriptScanner({
    gate,
    fails: options.fails,
    before: (call) => {
      const record: RunRecord = {
        repository: call.args[1] ?? "",
        output: call.args[call.args.indexOf("--output") + 1] ?? "",
        killed: false,
      };

      runs.set(record.repository, record);
      void call.whenKilled().then(() => {
        record.killed = true;
      });
    },
  });

  return { program, runs, release: () => gate.open() };
}

export function plantMarkerIn(
  files: FakeFiles,
  repository: string,
  changes: Record<string, unknown>,
  progress: string[] = [],
): void {
  const cache = `${repository}/.recognizer/cache`;

  files.writeFile(
    `${cache}/scan-running.json`,
    JSON.stringify({
      version: 5,
      run_id: "11111111-2222-3333-4444-555555555555",
      pid: 1,
      pgid: 1,
      started_at: new Date().toISOString(),
      started_by: "cli",
      repository,
      sensors: [],
      describe: false,
      suites: {},
      phase: "running",
      ended_at: null,
      exit: null,
      gaps: [],
      failure: null,
      commit: null,
      ran: null,
      ...changes,
    }),
  );
  files.writeFile(
    `${cache}/scan-running.progress.jsonl`,
    progress.map((line) => `${line}\n`).join(""),
  );
}

export function shippedSensor(name: string): Program {
  const manifest = readFileSync(
    join(ROOT, `schema/manifest-examples/valid/sensor-${name}.json`),
    "utf8",
  );

  return (call) => {
    const [verb] = call.args;
    const stdout =
      verb === "manifest"
        ? manifest
        : verb === "check"
          ? '{"gaps":[]}'
          : verb === "--version"
            ? "1\n"
            : "";

    return { started: true, status: 0, stdout, stderr: "" };
  };
}
