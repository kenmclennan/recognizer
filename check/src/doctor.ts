import { parse } from "yaml";
import {
  duplicateSuites,
  emptySections,
  expandedConfig,
  registeredSensors,
  schemaMessages,
  withoutEmptySections,
} from "./config-parse.js";
import {
  retiredKeysIn,
  toleratedMigration,
  withoutRetiredKeys,
} from "./config-retired.js";
import type { Language } from "./detect.js";
import { InputError } from "./errors.js";
import type { CachedScansState } from "./freshness.js";
import type { InstalledPlugin } from "./plugin-discovery.js";
import {
  kindOfProgram,
  type PluginFact,
  type PluginSpec,
  pluginProblems,
  scannerProblems,
} from "./plugin-doctor.js";
import { parsePolicy, RETIRED_KEYS } from "./policy.js";
import { policyProblems } from "./policy-problems.js";
import { PROBLEM_TITLES } from "./problem-titles.js";
import { SHIPPED_DESCRIBER_NAME } from "./shipped-describer.js";
import { shippedSensorOf } from "./shipped-sensors.js";
import {
  UNREGISTERED_FIX,
  unregisteredMessage,
} from "./unregistered-plugins.js";

export type AreaName =
  | "config"
  | "policy"
  | "scanners"
  | "sensors"
  | "describers";

export type ProblemCode =
  | "config-yaml"
  | "config-retired"
  | "config-empty"
  | "config-duplicate-suite"
  | "config-invalid"
  | "policy-invalid"
  | "scan-missing"
  | "scan-stale"
  | "policy-entry"
  | "policy-forbid"
  | "policy-retired"
  | "scanner-missing"
  | "scanner-ambiguous"
  | "scanner-choice"
  | "sensor-gap"
  | "plugin-missing"
  | "plugin-manifest"
  | "plugin-protocol"
  | "plugin-scan-schema"
  | "plugin-settings"
  | "describer-gap"
  | "unregistered-plugin";

type Found = Omit<RawProblem, "severity">;

export interface SetupProblem {
  code: ProblemCode;
  subject: string;
  title: string;
  line: string;
  fix: { text: string; command: string | null };
  severity: "problem" | "warning";
}

export type RawProblem = Omit<SetupProblem, "title"> & { display?: string };

export interface Area {
  name: AreaName;
  skipped: string | null;
  problems: SetupProblem[];
}

export interface DoctorReport {
  repository: string;
  ok: boolean;
  problems: number;
  warnings: number;
  areas: Area[];
}

export interface DoctorFacts {
  repository: string;
  named: boolean;
  configText: string | null;
  policyText: string | null;
  languages: Language[];
  scans(): CachedScansState;
  scanners: InstalledPlugin[];
  plugins(specs: PluginSpec[]): PluginFact[];
  shipped: { sensors: string[]; describer: boolean };
}

const CONFIG_FILE = ".recognizer/config.yaml";
const POLICY_FILE = ".recognizer/policy.yaml";
const SKIP_CONFIG = "config has problems";

function quoted(text: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(text)
    ? text
    : `'${text.replaceAll("'", "'\\''")}'`;
}

function withRepository(facts: DoctorFacts, command: string): string {
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

interface Registered {
  specs: PluginSpec[];
  named: Record<string, string>;
  install: Record<string, string>;
  sensors: string[];
  describer: boolean;
}

interface ConfigResult {
  problems: Found[];
  registered: Registered | { skipped: string };
}

const NONE: Registered = {
  specs: [],
  named: {},
  install: {},
  sensors: [],
  describer: false,
};

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

  if (text === undefined || shippedSensorOf(command) === undefined) {
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

function configArea(facts: DoctorFacts): ConfigResult {
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
  const messages = schemaMessages(cleaned);

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

function policyCommand(facts: DoctorFacts, arguments_: string): string {
  return withRepository(facts, `recognizer policy ${arguments_}`);
}

function entryFix(facts: DoctorFacts, glob: string): SetupProblem["fix"] {
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

function policyArea(facts: DoctorFacts): Found[] {
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

  let policy: ReturnType<typeof parsePolicy>;

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
    (policy.entryGlobs.length === 0 && policy.forbid.length === 0) ||
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

  return policyProblems(state.scans, policy).map((problem) =>
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

function unregisteredProblems(
  facts: DoctorFacts,
  registered: Registered,
  kind: PluginSpec["kind"],
): Found[] {
  const names =
    kind === "sensor"
      ? facts.shipped.sensors.filter(
          (name) => !registered.sensors.includes(name),
        )
      : facts.shipped.describer && !registered.describer
        ? [SHIPPED_DESCRIBER_NAME]
        : [];

  return names.map(
    (name): Found => ({
      code: "unregistered-plugin",
      subject: name,
      line: unregisteredMessage(name),
      fix: commandFix(UNREGISTERED_FIX(name)),
    }),
  );
}

function pluginArea(
  facts: DoctorFacts,
  registered: Registered | { skipped: string },
  kind: PluginSpec["kind"],
): { skipped: string | null; problems: Found[] } {
  if ("skipped" in registered) {
    return { skipped: registered.skipped, problems: [] };
  }

  const specs = registered.specs.filter((spec) => spec.kind === kind);

  return {
    skipped: null,
    problems: [
      ...(specs.length === 0
        ? []
        : facts.plugins(specs).flatMap((fact) => pluginProblems(fact))),
      ...unregisteredProblems(facts, registered, kind),
    ],
  };
}

function withSeverity(problems: Found[]): SetupProblem[] {
  return problems.map(({ display, ...one }) => ({
    severity: "problem" as const,
    ...one,
    title: PROBLEM_TITLES[one.code](display ?? one.subject),
  }));
}

export function buildReport(facts: DoctorFacts): DoctorReport {
  const config = configArea(facts);
  const known = "skipped" in config.registered ? NONE : config.registered;
  const areas: Area[] = [
    {
      name: "config",
      skipped: null,
      problems: withSeverity(config.problems),
    },
    {
      name: "policy",
      skipped: null,
      problems: withSeverity(policyArea(facts)),
    },
    {
      name: "scanners",
      skipped: null,
      problems: withSeverity(
        scannerProblems(
          facts.languages,
          facts.scanners,
          known.named,
          known.install,
        ),
      ),
    },
    ...(["sensor", "describer"] as const).map((kind): Area => {
      const area = pluginArea(facts, config.registered, kind);

      return {
        name: kind === "sensor" ? "sensors" : "describers",
        skipped: area.skipped,
        problems: withSeverity(area.problems),
      };
    }),
  ];
  const count = (severity: SetupProblem["severity"]) =>
    areas.reduce(
      (sum, area) =>
        sum + area.problems.filter((one) => one.severity === severity).length,
      0,
    );
  const problems = count("problem");

  return {
    repository: facts.repository,
    ok: problems === 0,
    problems,
    warnings: count("warning"),
    areas,
  };
}

export function reportText(report: DoctorReport): string {
  const lines: string[] = [];

  for (const area of report.areas) {
    if (area.skipped !== null) {
      lines.push(`${area.name} not checked: ${area.skipped}`);

      continue;
    }

    if (area.problems.length === 0) {
      continue;
    }

    lines.push(area.name);

    for (const problem of area.problems) {
      lines.push(
        `  ${problem.severity === "warning" ? "warning: " : ""}${problem.line}`,
        `    fix: ${problem.fix.text}`,
      );
    }
  }

  lines.push(
    report.ok
      ? "No problems"
      : `${report.problems} ${report.problems === 1 ? "problem" : "problems"}`,
  );

  if (report.warnings > 0) {
    lines.push(
      `${report.warnings} ${report.warnings === 1 ? "warning" : "warnings"}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function reportJson(report: DoctorReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
