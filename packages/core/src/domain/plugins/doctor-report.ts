import { chooseScanner, claimsLanguage } from "./choose-scanner.js";
import {
  grammarFieldsMessage,
  grammarsWithoutFields,
  grammarsWithoutVocabulary,
  grammarVocabularyMessage,
} from "./grammar-vocabulary.js";
import {
  CASK_UPGRADE,
  type InstalledPlugin,
  scanSchemaMessage,
} from "./installed-plugin.js";
import {
  type Manifest,
  type PluginFacts,
  type PluginKind,
  type ProtocolJudgement,
  supportedRange,
} from "./manifest.js";
import { type DisplayName, PROBLEM_TITLES } from "./problem-titles.js";
import { NO_RUN_LINE } from "./sensor-check.js";
import { UNREGISTERED_FIX, unregisteredMessage } from "./unregistered.js";

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
  | "plugin-tests-report"
  | "plugin-grammar-vocabulary"
  | "plugin-grammar-fields"
  | "plugin-settings"
  | "describer-gap"
  | "unregistered-plugin"
  | "sensor-manifest-missing";

export interface SetupProblem {
  code: ProblemCode;
  subject: string;
  title: string;
  line: string;
  fix: { text: string; command: string | null };
  severity: "problem" | "warning";
}

export type RawProblem = Omit<SetupProblem, "title"> & { display?: string };

export type Found = Omit<RawProblem, "severity">;

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

export interface PluginSpec {
  kind: "sensor" | "describer";
  subject: string;
  name: string;
  program: string;
  command: string[];
  settings: Record<string, unknown> | null;
  installLine: string | null;
  manifest?: string[];
}

export type PluginState =
  | { status: "missing" }
  | { status: "unreadable"; reason: string }
  | {
      status: "read";
      manifest: Manifest;
      judgement: ProtocolJudgement;
      gaps: string[] | null;
    };

export interface PluginFact extends PluginSpec {
  state: PluginState;
}

interface SettingEntry {
  key: string;
  type: string;
  values?: string[];
  multi?: boolean;
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
  exclusiveMaximum?: number;
  off?: boolean;
}

function textFix(text: string): SetupProblem["fix"] {
  return { text, command: null };
}

function problem(
  code: SetupProblem["code"],
  subject: string,
  line: string,
  fix: SetupProblem["fix"],
  severity: SetupProblem["severity"] = "problem",
  display?: string,
): RawProblem {
  return display === undefined
    ? { code, subject, line, fix, severity }
    : { code, subject, line, fix, severity, display };
}

function protocolLine(
  program: string,
  protocol: number,
  judgement: ProtocolJudgement,
  current: number,
): string {
  return judgement === "unsupported"
    ? `${program} speaks protocol ${protocol} and recognizer supports ${supportedRange(current)}`
    : `${program} speaks the previous protocol ${protocol} and recognizer is at ${current}`;
}

function protocolProblem(
  subject: string,
  program: string,
  manifest: Manifest,
  judgement: ProtocolJudgement,
  installLine: string | null,
  current: number,
  display?: string,
): RawProblem[] {
  if (judgement === "current") {
    return [];
  }

  return [
    problem(
      "plugin-protocol",
      subject,
      protocolLine(program, manifest.protocol, judgement, current),
      textFix(installLine ?? manifest.install),
      judgement === "previous" ? "warning" : "problem",
      display,
    ),
  ];
}

function leaves(
  value: unknown,
  path: string[],
): { path: string[]; value: unknown }[] {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, inner]) =>
      leaves(inner, [...path, key]),
    );
  }

  return [{ path, value }];
}

function matches(entry: SettingEntry, path: string[]): boolean {
  const segments = entry.key.split(".");

  return (
    segments.length === path.length &&
    segments.every(
      (segment, at) => /^<[^>]+>$/.test(segment) || segment === path[at],
    )
  );
}

function breaks(entry: SettingEntry, value: unknown): string | null {
  if (entry.type === "boolean") {
    return typeof value === "boolean" ? null : "must be true or false";
  }

  if (entry.type === "integer" || entry.type === "number") {
    if (entry.off === true && value === false) {
      return null;
    }

    if (
      typeof value !== "number" ||
      (entry.type === "integer" && !Number.isInteger(value))
    ) {
      return `must be ${entry.type === "integer" ? "an integer" : "a number"}`;
    }

    if (entry.minimum !== undefined && value < entry.minimum) {
      return `must be at least ${entry.minimum}`;
    }

    if (
      entry.exclusiveMinimum !== undefined &&
      value <= entry.exclusiveMinimum
    ) {
      return `must be above ${entry.exclusiveMinimum}`;
    }

    if (entry.maximum !== undefined && value > entry.maximum) {
      return `must be at most ${entry.maximum}`;
    }

    if (
      entry.exclusiveMaximum !== undefined &&
      value >= entry.exclusiveMaximum
    ) {
      return `must be below ${entry.exclusiveMaximum}`;
    }

    return null;
  }

  if (typeof value !== "string") {
    return "must be text";
  }

  if (entry.type === "enum" && !(entry.values ?? []).includes(value)) {
    return `must be one of ${(entry.values ?? []).join(", ")}`;
  }

  return null;
}

export function settingProblems(
  subject: string,
  settings: Record<string, unknown>,
  declared: unknown[],
): RawProblem[] {
  const entries = declared as SettingEntry[];

  return leaves(settings, []).flatMap(({ path, value }) => {
    const key = path.join(".");
    const entry = entries.find((one) => matches(one, path));

    if (entry === undefined) {
      return [
        problem(
          "plugin-settings",
          subject,
          `${subject} has no setting ${key}`,
          textFix(`remove ${key} from sensors.${subject} or correct its name`),
        ),
      ];
    }

    const items = Array.isArray(value) ? value : [value];
    const wrong = items
      .map((item) => breaks(entry, item))
      .find((reason) => reason !== null);

    return wrong === undefined || wrong === null
      ? []
      : [
          problem(
            "plugin-settings",
            subject,
            `${subject} setting ${key} ${wrong}`,
            textFix(`correct ${key} in sensors.${subject}`),
          ),
        ];
  });
}

function missingFix(fact: PluginFact): SetupProblem["fix"] {
  return textFix(
    fact.installLine ??
      `install ${fact.program}: no install line is recorded for it, run recognizer plugin add ${fact.name} on a machine that has it`,
  );
}

export function pluginProblems(
  fact: PluginFact,
  facts: PluginFacts,
): RawProblem[] {
  const { state, subject, program } = fact;

  if (state.status === "missing") {
    return [
      problem(
        "plugin-missing",
        subject,
        `${program} is not installed: it is not on PATH`,
        missingFix(fact),
      ),
    ];
  }

  if (state.status === "unreadable") {
    return [
      problem(
        "plugin-manifest",
        subject,
        state.reason,
        textFix(`run recognizer plugin check ${program}`),
      ),
    ];
  }

  const found = protocolProblem(
    subject,
    program,
    state.manifest,
    state.judgement,
    fact.installLine,
    facts.protocol,
    state.manifest.display,
  );

  if (state.judgement === "unsupported") {
    return found;
  }

  const gaps = (state.gaps ?? []).map((line) =>
    fact.kind === "sensor"
      ? problem(
          "sensor-gap",
          subject,
          line,
          {
            text: `recognizer help sensors ${fact.name}`,
            command: `recognizer help sensors ${fact.name}`,
          },
          "problem",
          state.manifest.display,
        )
      : problem(
          "describer-gap",
          subject,
          line,
          line === NO_RUN_LINE
            ? textFix(
                "add the run word to the describer command with recognizer config describer.command",
              )
            : textFix(`run ${program} check`),
          "problem",
          state.manifest.display,
        ),
  );

  if (gaps.length > 0) {
    return [...found, ...gaps];
  }

  const settings =
    fact.settings === null
      ? []
      : settingProblems(subject, fact.settings, state.manifest.settings);

  return [...found, ...gaps, ...settings];
}

export function scannerProblems(
  languages: readonly string[],
  scanners: readonly InstalledPlugin[],
  named: Record<string, string>,
  install: Record<string, string>,
  facts: PluginFacts,
): RawProblem[] {
  const found: RawProblem[] = [];

  if (scanners.length === 0) {
    found.push(
      problem(
        "scanner-missing",
        "scanners",
        "no scanner is installed",
        textFix(
          "install a scanner that claims a language: recognizer plugins lists what is installed",
        ),
      ),
    );
  }

  const all = [...new Set([...languages, ...Object.keys(named)])].sort();

  for (const language of all) {
    const choice = chooseScanner(language, scanners, named[language]);

    if (choice.ok) {
      found.push(
        ...protocolProblem(
          language,
          `recognizer-scan-${choice.scanner.name}`,
          choice.scanner.manifest,
          choice.scanner.judgement,
          install[`recognizer-scan-${choice.scanner.name}`] ?? null,
          facts.protocol,
        ),
      );

      const line = scanSchemaMessage(
        choice.scanner,
        facts,
        install[`recognizer-scan-${choice.scanner.name}`] ?? undefined,
      );

      if (line !== null) {
        found.push(
          problem(
            "plugin-scan-schema",
            language,
            line,
            textFix(
              choice.scanner.schema === "newer"
                ? CASK_UPGRADE
                : (install[`recognizer-scan-${choice.scanner.name}`] ??
                    choice.scanner.manifest.install),
            ),
          ),
        );
      }

      const unvocabularied = grammarsWithoutVocabulary(choice.scanner.manifest);

      if (unvocabularied.length > 0) {
        const program = `recognizer-scan-${choice.scanner.name}`;

        found.push(
          problem(
            "plugin-grammar-vocabulary",
            language,
            grammarVocabularyMessage(program, unvocabularied),
            textFix(install[program] ?? choice.scanner.manifest.install),
          ),
        );
      }

      const fieldless = grammarsWithoutFields(choice.scanner.manifest);

      if (fieldless.length > 0) {
        const program = `recognizer-scan-${choice.scanner.name}`;

        found.push(
          problem(
            "plugin-grammar-fields",
            language,
            grammarFieldsMessage(program, fieldless),
            textFix(install[program] ?? choice.scanner.manifest.install),
          ),
        );
      }

      const reporter = scanners.find(
        (one) =>
          one !== choice.scanner &&
          claimsLanguage(one, language) &&
          one.manifest.reports_tests === true,
      );

      if (
        reporter !== undefined &&
        choice.scanner.manifest.reports_tests !== true
      ) {
        const program = `recognizer-scan-${choice.scanner.name}`;

        found.push(
          problem(
            "plugin-tests-report",
            language,
            `${program} does not declare reports_tests, though recognizer-scan-${reporter.name} does for ${language}, so tests kept inside source files are not hashed and the repository reads as out of date`,
            textFix(install[program] ?? choice.scanner.manifest.install),
            "warning",
          ),
        );
      }

      continue;
    }

    const setting = (name: string) =>
      `recognizer config scanners.${language} ${name}`;

    if (choice.reason === "not-installed") {
      const wanted = named[language];

      found.push(
        problem(
          "scanner-missing",
          language,
          choice.message,
          textFix(
            wanted === undefined
              ? `install a scanner that claims ${language}: recognizer plugins lists what is installed`
              : `install recognizer-scan-${wanted}`,
          ),
        ),
      );
    } else if (choice.reason === "ambiguous-scanner") {
      found.push(
        problem(
          "scanner-ambiguous",
          language,
          choice.message,
          textFix(choice.claimants.map(setting).join(" or ")),
        ),
      );
    } else {
      found.push(
        problem(
          "scanner-choice",
          language,
          choice.message,
          textFix(
            choice.claimants.length === 0
              ? `recognizer config --unset scanners.${language}`
              : choice.claimants.map(setting).join(" or "),
          ),
        ),
      );
    }
  }

  return found;
}

export function kindOfProgram(program: string): PluginKind | null {
  if (program.includes("/")) {
    return null;
  }

  if (/^recognizer-sense-.+/.test(program)) {
    return "sensor";
  }

  return /^recognizer-describe-.+/.test(program) ? "describer" : null;
}

export interface RegisteredPlugins {
  specs: PluginSpec[];
  named: Record<string, string>;
  install: Record<string, string>;
  sensors: string[];
  describer: boolean;
}

export type ConfigRegistration = RegisteredPlugins | { skipped: string };

export interface DoctorFacts {
  repository: string;
  configProblems: Found[];
  registered: ConfigRegistration;
  policyProblems: Found[];
  languages: string[];
  scanners: InstalledPlugin[];
  plugins(specs: PluginSpec[]): PluginFact[];
  testsUnrun: { name: string; display?: string }[];
  protocol: PluginFacts;
}

const NONE: RegisteredPlugins = {
  specs: [],
  named: {},
  install: {},
  sensors: [],
  describer: false,
};

function unregisteredProblems(
  facts: DoctorFacts,
  kind: PluginSpec["kind"],
): Found[] {
  if (kind !== "sensor") {
    return [];
  }

  return facts.testsUnrun.map(
    ({ name, display }): Found => ({
      code: "unregistered-plugin",
      subject: name,
      line: unregisteredMessage(name),
      fix: { text: UNREGISTERED_FIX(name), command: UNREGISTERED_FIX(name) },
      display,
    }),
  );
}

function pluginArea(
  facts: DoctorFacts,
  registered: ConfigRegistration,
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
        : facts
            .plugins(specs)
            .flatMap((fact) => pluginProblems(fact, facts.protocol))),
      ...unregisteredProblems(facts, kind),
    ],
  };
}

function languageDisplay(scanners: readonly InstalledPlugin[]): DisplayName {
  const names = new Map<string, string>();

  for (const scanner of scanners) {
    for (const language of scanner.manifest.languages ?? []) {
      const { name, display } = language as { name: string; display?: string };

      if (display !== undefined && !names.has(name)) {
        names.set(name, display);
      }
    }
  }

  return (id) => names.get(id) ?? id;
}

function withSeverity(problems: Found[], display: DisplayName): SetupProblem[] {
  return problems.map(({ display: shown, ...one }) => ({
    severity: "problem" as const,
    ...one,
    title: PROBLEM_TITLES[one.code](shown ?? one.subject, display),
  }));
}

export function buildReport(facts: DoctorFacts): DoctorReport {
  const known = "skipped" in facts.registered ? NONE : facts.registered;
  const display = languageDisplay(facts.scanners);
  const areas: Area[] = [
    {
      name: "config",
      skipped: null,
      problems: withSeverity(facts.configProblems, display),
    },
    {
      name: "policy",
      skipped: null,
      problems: withSeverity(facts.policyProblems, display),
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
          facts.protocol,
        ),
        display,
      ),
    },
    ...(["sensor", "describer"] as const).map((kind): Area => {
      const area = pluginArea(facts, facts.registered, kind);

      return {
        name: kind === "sensor" ? "sensors" : "describers",
        skipped: area.skipped,
        problems: withSeverity(area.problems, display),
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
