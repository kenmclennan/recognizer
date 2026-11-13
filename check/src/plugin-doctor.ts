import type { SetupProblem } from "./doctor.js";
import type { InstalledPlugin } from "./plugin-discovery.js";
import { supportedRange } from "./plugin-discovery.js";
import {
  CURRENT_PROTOCOL,
  type Manifest,
  type PluginKind,
  type ProtocolJudgement,
} from "./plugin-manifest.js";
import { chooseScanner } from "./scanners.js";

export interface PluginSpec {
  kind: "sensor" | "describer";
  subject: string;
  name: string;
  program: string;
  command: string[];
  settings: Record<string, unknown> | null;
  installLine: string | null;
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
): SetupProblem {
  return { code, subject, line, fix, severity };
}

function protocolLine(
  program: string,
  protocol: number,
  judgement: ProtocolJudgement,
): string {
  return judgement === "unsupported"
    ? `${program} speaks protocol ${protocol} and recognizer supports ${supportedRange()}`
    : `${program} speaks the previous protocol ${protocol} and recognizer is at ${CURRENT_PROTOCOL}`;
}

function protocolProblem(
  subject: string,
  program: string,
  manifest: Manifest,
  judgement: ProtocolJudgement,
  installLine: string | null,
): SetupProblem[] {
  if (judgement === "current") {
    return [];
  }

  return [
    problem(
      "plugin-protocol",
      subject,
      protocolLine(program, manifest.protocol, judgement),
      textFix(installLine ?? manifest.install),
      judgement === "previous" ? "warning" : "problem",
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
): SetupProblem[] {
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

export function pluginProblems(fact: PluginFact): SetupProblem[] {
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
  );

  if (state.judgement === "unsupported") {
    return found;
  }

  const gaps = (state.gaps ?? []).map((line) =>
    fact.kind === "sensor"
      ? problem("sensor-gap", subject, line, {
          text: `recognizer help sensors ${fact.name}`,
          command: `recognizer help sensors ${fact.name}`,
        })
      : problem(
          "describer-gap",
          subject,
          line,
          textFix(`run ${program} check`),
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
): SetupProblem[] {
  const found: SetupProblem[] = [];

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
        ),
      );

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
