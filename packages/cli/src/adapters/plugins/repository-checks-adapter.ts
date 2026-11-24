import { join } from "node:path";
import {
  type ConfigReading,
  type Found,
  type InstalledPlugin,
  kindOfProgram,
  type PluginSpec,
  PolicyRule,
  type PublishedValues,
  type RegisteredPlugins,
  type RepositoryChecks,
  type SetupProblem,
  sensorNameOf,
  unpublishedValues,
} from "@recognizer/core";
import { parse } from "yaml";
import type { Io } from "../../cli.js";
import { configFile, readConfig } from "../../config.js";
import {
  duplicateSuites,
  emptySections,
  expandedConfig,
  registeredSensors,
  schemaMessages,
  withoutEmptySections,
} from "../../config-parse.js";
import {
  retiredKeysIn,
  toleratedMigration,
  withoutRetiredKeys,
} from "../../config-retired.js";
import { detectLanguages } from "../../detect.js";
import { InputError } from "../../errors.js";
import { type CachedScansState, cachedScansState } from "../../freshness.js";
import { policyProblems } from "../../policy-problems.js";
import { languageRulesOf } from "../../scanners.js";
import { parsePolicy, RETIRED_KEYS } from "../filesystem/policy-translator.js";
import { KeyOwnersAdapter } from "./key-owners-adapter.js";

export interface Context {
  repository: string;
  named: boolean;
  configText: string | null;
  policyText: string | null;
  languages: string[];
  scans(): CachedScansState;
}

const NONE: RegisteredPlugins = {
  specs: [],
  named: {},
  install: {},
  sensors: [],
  describer: false,
};

const CONFIG_FILE = ".recognizer/config.yaml";
const POLICY_FILE = ".recognizer/policy.yaml";
const SKIP_CONFIG = "config has problems";

function quoted(text: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(text)
    ? text
    : `'${text.replaceAll("'", "'\\''")}'`;
}

function withRepository(facts: Context, command: string): string {
  return facts.named
    ? `${command} --repository ${quoted(facts.repository)}`
    : command;
}

function commandFix(command: string): SetupProblem["fix"] {
  return { text: command, command };
}

function textFix(text: string): SetupProblem["fix"] {
  return { text, command: null };
}

function schemaSubject(message: string): string {
  const path = /^config(\S*)/.exec(message)?.[1] ?? "";

  return path === "" ? "config" : path.slice(1).replaceAll("/", ".");
}

function hasSuites(document: unknown): boolean {
  const tests = (document as { tests?: unknown } | null)?.tests;

  return Array.isArray(tests) && tests.length > 0;
}

function stringMap(value: unknown): Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};
}

function settingsOf(command: string[]): Record<string, unknown> | null {
  const at = command.indexOf("--settings");
  const text = at === -1 ? undefined : command[at + 1];

  if (text === undefined || sensorNameOf(command) === undefined) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);

    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function specsOf(
  config: ReturnType<typeof expandedConfig>,
  install: Record<string, string>,
): PluginSpec[] {
  const specs: PluginSpec[] = [];

  for (const sensor of registeredSensors(config)) {
    const program = sensor.command[0] as string;

    if (kindOfProgram(program) === "sensor") {
      specs.push({
        kind: "sensor",
        subject: sensor.name,
        name: program.slice("recognizer-sense-".length),
        program,
        command: sensor.command,
        settings: settingsOf(sensor.command),
        installLine: install[program] ?? null,
      });
    }
  }

  const program = config.describer?.command[0];

  if (program !== undefined && kindOfProgram(program) === "describer") {
    specs.push({
      kind: "describer",
      subject: "describer",
      name: program.slice("recognizer-describe-".length),
      program,
      command: config.describer?.command ?? [program],
      settings: null,
      installLine: install[program] ?? null,
    });
  }

  return specs;
}

export function readConfigArea(
  facts: Context,
  keys: () => PublishedValues,
): ConfigReading {
  if (facts.configText === null) {
    return { problems: [], registered: NONE };
  }

  let document: unknown;

  try {
    document = parse(facts.configText) ?? {};
  } catch (error) {
    return {
      problems: [
        {
          code: "config-yaml",
          subject: CONFIG_FILE,
          line: `config is not valid YAML: ${(error as Error).message}`,
          fix: textFix(`correct the YAML in ${CONFIG_FILE}`),
        },
      ],
      registered: {
        skipped: SKIP_CONFIG,
      },
    };
  }

  const problems: Found[] = [];

  for (const retired of retiredKeysIn(document)) {
    const key = retired.path.join(".");
    const migration = retired.tolerated
      ? toleratedMigration(document, (command) =>
          withRepository(facts, command),
        )
      : null;

    if (migration !== null) {
      problems.push({
        code: "config-retired",
        subject: key,
        line: migration.line,
        fix: commandFix(migration.command),
      });

      continue;
    }

    problems.push({
      code: "config-retired",
      subject: key,
      line: retired.message,
      fix: commandFix(
        withRepository(facts, `recognizer config --unset ${key}`),
      ),
    });
  }

  for (const empty of emptySections(document)) {
    const key = empty.path.join(".");
    const removable = empty.path.length === 2 && empty.path[0] === "sensors";

    problems.push({
      code: "config-empty",
      subject: key,
      line: empty.message,
      fix: removable
        ? commandFix(
            withRepository(facts, `recognizer config --remove-section ${key}`),
          )
        : textFix(`delete ${key} in ${CONFIG_FILE}, or give it settings`),
    });
  }

  for (const duplicate of duplicateSuites(document)) {
    problems.push({
      code: "config-duplicate-suite",
      subject: duplicate.name,
      line: duplicate.message,
      fix: textFix(
        `rename or remove one of the test suites named ${duplicate.name} in ${CONFIG_FILE}`,
      ),
    });
  }

  const cleaned = withoutEmptySections(withoutRetiredKeys(document));
  const schema = schemaMessages(cleaned);
  const messages = [
    ...schema,
    ...(schema.length === 0 && hasSuites(cleaned)
      ? unpublishedValues(cleaned, keys())
      : []),
  ];

  for (const message of messages) {
    problems.push({
      code: "config-invalid",
      subject: schemaSubject(message),
      line: message,
      fix: textFix(`correct ${schemaSubject(message)} in ${CONFIG_FILE}`),
    });
  }

  if (messages.length > 0) {
    return { problems, registered: { skipped: SKIP_CONFIG } };
  }

  const record = (cleaned ?? {}) as Record<string, unknown>;
  const install = stringMap(record.install);

  return {
    problems,
    registered: {
      specs: specsOf(expandedConfig(cleaned), install),
      named: stringMap(record.scanners),
      install,
      sensors: registeredSensors(expandedConfig(cleaned)).map(
        (one) => one.name,
      ),
      describer: record.describer !== undefined,
    },
  };
}

function policyCommand(facts: Context, arguments_: string): string {
  return withRepository(facts, `recognizer policy ${arguments_}`);
}

function entryFix(facts: Context, glob: string): SetupProblem["fix"] {
  return commandFix(policyCommand(facts, `--unset entry ${quoted(glob)}`));
}

function invalidFix(): SetupProblem["fix"] {
  return textFix(
    `recognizer policy cannot repair a structurally invalid policy: correct ${POLICY_FILE} by hand, then run recognizer policy --list to confirm it reads`,
  );
}

function retiredPolicyKeys(policyText: string): string[] {
  let document: unknown;

  try {
    document = parse(policyText);
  } catch {
    return [];
  }

  if (typeof document !== "object" || document === null) {
    return [];
  }

  return Object.keys(document).filter((key) =>
    (RETIRED_KEYS as readonly string[]).includes(key),
  );
}

export function readPolicyArea(facts: Context): Found[] {
  if (facts.policyText === null) {
    return [];
  }

  const retired = retiredPolicyKeys(facts.policyText);
  const found: Found[] = [];

  if (retired.length > 0) {
    found.push({
      code: "policy-retired",
      subject: POLICY_FILE,
      line: `the policy uses retired keys: ${retired.join(", ")}`,
      fix: commandFix(policyCommand(facts, "--migrate")),
    });
  }

  let policy: PolicyRule[];

  try {
    policy = parsePolicy(facts.policyText);
  } catch (error) {
    const messages =
      error instanceof InputError ? error.messages : [(error as Error).message];

    return [
      ...found,
      ...messages
        .filter((line) => !/^policy: "[^"]+" is retired;/.test(line))
        .map((line) => ({
          code: "policy-invalid" as const,
          subject: POLICY_FILE,
          line,
          fix: invalidFix(),
        })),
    ];
  }

  if (
    (PolicyRule.entries(policy).length === 0 &&
      PolicyRule.forbids(policy).length === 0) ||
    facts.languages.length === 0
  ) {
    return [];
  }

  const state = facts.scans();
  const where = facts.languages.join(", ");

  if (state.state === "missing") {
    return [
      {
        code: "scan-missing",
        subject: where,
        line: `no scan of ${where}: the policy was not compared with the code`,
        fix: commandFix(
          `recognizer scan${facts.named ? ` ${quoted(facts.repository)}` : ""}`,
        ),
      },
    ];
  }

  const scan = `recognizer scan${facts.named ? ` ${quoted(facts.repository)}` : ""}`;

  if (state.state === "stale" && state.reason === "uncommitted") {
    const count = state.paths.length;
    const shown = state.paths.slice(0, 3).join(", ");
    const more = count > 3 ? ` and ${count - 3} more` : "";

    return [
      {
        code: "scan-stale",
        subject: where,
        line: `the scan of ${where} was not used: the working tree has ${count} uncommitted ${count === 1 ? "change" : "changes"} outside .recognizer/ (${shown}${more}), so the policy was not compared with the code`,
        fix: textFix(`commit, ignore or stash these changes, then run ${scan}`),
      },
    ];
  }

  if (state.state === "stale") {
    return [
      {
        code: "scan-stale",
        subject: where,
        line: `the scan of ${where} is out of date with the working tree: the policy was not compared with the code`,
        fix: commandFix(scan),
      },
    ];
  }

  return policyProblems(state.repository, policy).map((problem) =>
    problem.kind === "entry"
      ? {
          code: "policy-entry" as const,
          subject: problem.subject,
          line: problem.text,
          fix: entryFix(facts, problem.subject),
        }
      : {
          code: "policy-forbid" as const,
          subject: problem.subject,
          line: problem.text,
          fix: textFix(
            `correct the glob ${problem.subject} in ${POLICY_FILE}, or remove it from its forbid rule`,
          ),
        },
  );
}

function readIfPresent(io: Io, file: string): string | null {
  return io.exists(file) ? io.readFile(file) : null;
}

export class RepositoryChecksAdapter implements RepositoryChecks {
  constructor(private readonly io: Io) {}

  isDirectory(root: string): boolean {
    try {
      this.io.readDir(root);

      return true;
    } catch {
      return false;
    }
  }

  languages(root: string, scanners: readonly InstalledPlugin[]): string[] {
    return detectLanguages(this.io, root, languageRulesOf(scanners));
  }

  config(root: string, named: boolean): ConfigReading {
    return readConfigArea(
      {
        repository: root,
        named,
        configText: readIfPresent(this.io, configFile(root)),
        policyText: null,
        languages: [],
        scans: () => cachedScansState(this.io, root, []),
      },
      () => new KeyOwnersAdapter(this.io).schemas().schema.keys,
    );
  }

  policy(root: string, named: boolean, languages: string[]): Found[] {
    return readPolicyArea({
      repository: root,
      named,
      configText: null,
      policyText: readIfPresent(
        this.io,
        join(root, ".recognizer", "policy.yaml"),
      ),
      languages,
      scans: () => cachedScansState(this.io, root, languages),
    });
  }

  registeredSensors(root: string): { name: string; command: string[] }[] {
    return registeredSensors(readConfig(this.io, root, ["sensors"]));
  }

  suites(root: string): readonly unknown[] | undefined {
    try {
      return readConfig(this.io, root, ["tests"])?.tests;
    } catch {
      return undefined;
    }
  }
}
