import { parse } from "yaml";
import {
  duplicateSuites,
  emptySections,
  expandedConfig,
  registeredSensors,
  schemaMessages,
  withoutEmptySections,
} from "./config-parse.js";
import { retiredKeysIn, withoutRetiredKeys } from "./config-retired.js";
import type { Language } from "./detect.js";
import { InputError } from "./errors.js";
import type { CachedScansState } from "./freshness.js";
import { parsePolicy } from "./policy.js";
import { policyProblems } from "./policy-problems.js";
import { BREW_FIX } from "./preflight.js";
import { type ScannerSpec, scannerFor } from "./scanners.js";
import type { CheckableSensor, SensorReport } from "./sensors-check.js";

export type AreaName = "config" | "policy" | "scanners" | "sensors";

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
  | "policy-folder"
  | "scanner-override"
  | "scanner-missing"
  | "sensor-gap";

export interface SetupProblem {
  code: ProblemCode;
  subject: string;
  line: string;
  fix: { text: string; command: string | null };
}

export interface Area {
  name: AreaName;
  skipped: string | null;
  problems: SetupProblem[];
}

export interface DoctorReport {
  repository: string;
  ok: boolean;
  problems: number;
  areas: Area[];
}

export type ScannerAvailability =
  | { available: true }
  | { available: false; reason: "override" | "missing"; message: string };

export interface DoctorFacts {
  repository: string;
  named: boolean;
  configText: string | null;
  policyText: string | null;
  languages: Language[];
  scans(): CachedScansState;
  scanner(spec: ScannerSpec): ScannerAvailability;
  sensorReports(sensors: CheckableSensor[]): SensorReport[];
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

interface ConfigResult {
  problems: SetupProblem[];
  sensors: SensorsInput;
}

type SensorsInput = { checkable: CheckableSensor[] } | { skipped: string };

function configArea(facts: DoctorFacts): ConfigResult {
  if (facts.configText === null) {
    return { problems: [], sensors: { checkable: [] } };
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
      sensors: { skipped: SKIP_CONFIG },
    };
  }

  const problems: SetupProblem[] = [];

  for (const retired of retiredKeysIn(document)) {
    const key = retired.path.join(".");

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

  return {
    problems,
    sensors:
      messages.length > 0
        ? { skipped: SKIP_CONFIG }
        : { checkable: registeredSensors(expandedConfig(cleaned)) },
  };
}

function policyArea(facts: DoctorFacts): SetupProblem[] {
  if (facts.policyText === null) {
    return [];
  }

  let policy: ReturnType<typeof parsePolicy>;

  try {
    policy = parsePolicy(facts.policyText);
  } catch (error) {
    const messages =
      error instanceof InputError ? error.messages : [(error as Error).message];

    return messages.map((line) => ({
      code: "policy-invalid" as const,
      subject: POLICY_FILE,
      line,
      fix: textFix(`correct ${POLICY_FILE}`),
    }));
  }

  if (policy.components.size === 0 || facts.languages.length === 0) {
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

  return policyProblems(state.scans, policy).map((problem) => ({
    code:
      problem.kind === "entry" ? ("policy-entry" as const) : "policy-folder",
    subject: problem.subject,
    line: problem.text,
    fix: textFix(`correct ${POLICY_FILE} so the policy matches the code`),
  }));
}

function scannersArea(facts: DoctorFacts): SetupProblem[] {
  return facts.languages.flatMap((language): SetupProblem[] => {
    const spec = scannerFor(language);
    const result = facts.scanner(spec);

    if (result.available) {
      return [];
    }

    if (result.reason === "override") {
      return [
        {
          code: "scanner-override" as const,
          subject: language,
          line: result.message,
          fix: textFix(
            `set ${spec.variable} to an absolute path, or unset it to use ${spec.name} from PATH`,
          ),
        },
      ];
    }

    return [
      {
        code: "scanner-missing" as const,
        subject: language,
        line: result.message,
        fix: {
          text: BREW_FIX,
          command: BREW_FIX,
        },
      },
    ];
  });
}

function sensorsArea(
  facts: DoctorFacts,
  input: SensorsInput,
): { skipped: string | null; problems: SetupProblem[] } {
  if ("skipped" in input) {
    return { skipped: input.skipped, problems: [] };
  }

  if (input.checkable.length === 0) {
    return { skipped: null, problems: [] };
  }

  const problems = facts.sensorReports(input.checkable).flatMap((report) =>
    report.gaps.map((gap) => ({
      code: "sensor-gap" as const,
      subject: report.name,
      line: gap.line,
      fix:
        gap.code === "sensors-missing"
          ? commandFix(BREW_FIX)
          : commandFix(`recognizer help sensors ${report.name}`),
    })),
  );

  return { skipped: null, problems };
}

export function buildReport(facts: DoctorFacts): DoctorReport {
  const config = configArea(facts);
  const sensors = sensorsArea(facts, config.sensors);
  const areas: Area[] = [
    { name: "config", skipped: null, problems: config.problems },
    { name: "policy", skipped: null, problems: policyArea(facts) },
    { name: "scanners", skipped: null, problems: scannersArea(facts) },
    { name: "sensors", ...sensors },
  ];
  const problems = areas.reduce((sum, area) => sum + area.problems.length, 0);

  return { repository: facts.repository, ok: problems === 0, problems, areas };
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
      lines.push(`  ${problem.line}`, `    fix: ${problem.fix.text}`);
    }
  }

  lines.push(
    report.ok
      ? "No problems"
      : `${report.problems} ${report.problems === 1 ? "problem" : "problems"}`,
  );

  return `${lines.join("\n")}\n`;
}

export function reportJson(report: DoctorReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
