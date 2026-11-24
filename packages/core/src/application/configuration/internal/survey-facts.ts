import {
  splitCommand,
  withoutRepository,
} from "../../../domain/configuration/setup-changes.js";
import { commandRefusal } from "../../../domain/configuration/setup-command-grammar.js";
import type {
  SetupMark,
  SurveyCheck,
  SurveyFix,
  SurveyFolder,
  SurveyLanguage,
  SurveyLimit,
  SurveyPolicy,
  SurveySuite,
} from "../../../domain/configuration/setup-survey.js";
import { compileGlob } from "../../../domain/glob.js";
import { baseName } from "../../../domain/path.js";
import { PolicyRule } from "../../../domain/policy-rule.js";
import type { Repository } from "../../../domain/repository.js";
import type { ConfigKeyEntry } from "../ports/config-keys.js";
import type {
  InstalledCheck,
  LanguageClaim,
  SetupDoctorReport,
} from "./configuration-ports.js";
import { compareText, normalizeDirectory } from "./text-paths.js";

const LIMIT_KEYS = [
  {
    key: "sensors.structure.warnings.long_function.limit",
    label: "long_function",
  },
  { key: "sensors.structure.warnings.complexity.limit", label: "complexity" },
  {
    key: "sensors.structure.duplication.pair_min_lines",
    label: "pair_min_lines",
  },
];

const FOLDER_LIMIT = 5;

type Document = Record<string, unknown>;

export function folderOf(path: string): string {
  const at = path.indexOf("/");

  return at === -1 ? "." : path.slice(0, at);
}

function compareFolders(a: SurveyFolder, b: SurveyFolder): number {
  return b.files - a.files || compareText(a.path, b.path);
}

export function foldersOf(paths: string[]): SurveyFolder[] {
  const counts = new Map<string, number>();

  for (const path of paths) {
    const folder = folderOf(path);

    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }

  return [...counts]
    .map(([path, files]) => ({ path, files }))
    .sort(compareFolders)
    .slice(0, FOLDER_LIMIT);
}

export function filterListing(listing: string[]): string[] {
  return listing
    .filter(
      (path) =>
        !path
          .split("/")
          .some(
            (part) =>
              part === "node_modules" || part === "target" || part === ".git",
          ),
    )
    .sort(compareText);
}

export function filesOf(repository: Repository): SurveyLanguage[] {
  return repository.extractions
    .map((extraction) => {
      const paths = repository.files
        .filter((file) => file.language === extraction.language)
        .map((file) => file.path);

      return {
        language: extraction.language,
        files: paths.length,
        folders: foldersOf(paths),
        mark: null,
      };
    })
    .sort((a, b) => compareText(a.language, b.language));
}

export function claimedBy(rule: LanguageClaim, path: string): boolean {
  return (
    rule.files.includes(baseName(path)) ||
    rule.extensions.some((extension) => path.endsWith(extension))
  );
}

function valueAt(document: unknown, path: string[]): unknown {
  let at = document;

  for (const part of path) {
    if (typeof at !== "object" || at === null) {
      return undefined;
    }

    at = (at as Record<string, unknown>)[part];
  }

  return at;
}

function limitsOf(
  document: Document,
  entries: readonly ConfigKeyEntry[],
): SurveyLimit[] {
  return LIMIT_KEYS.map(({ key, label }) => {
    const entry = entries.find((one) => one.key === key);
    const current = valueAt(document, key.split("."));

    return {
      key,
      label,
      default: typeof entry?.default === "number" ? entry.default : 0,
      current: typeof current === "number" ? current : null,
    };
  });
}

function checkMark(configured: boolean, enabled: boolean): SetupMark | null {
  if (!configured) {
    return null;
  }

  return enabled ? "set-up" : "new";
}

export function checksOf(
  document: Document,
  configured: boolean,
  installed: {
    sensors: InstalledCheck[];
    describers: InstalledCheck[];
    keys: readonly ConfigKeyEntry[];
  },
): SurveyCheck[] {
  const structure = valueAt(document, ["sensors", "structure"]);
  const registered = valueAt(document, ["sensors"]);

  return [
    {
      id: "structure",
      display: "Structure",
      description:
        "the files, imports and policy rules of the repository, read from the scan",
      always_on: true,
      enabled: true,
      runs_tests: false,
      limits: [],
      mark: configured ? "set-up" : null,
    },
    {
      id: "analysis",
      display: "Structural analysis",
      description:
        "warnings about cycles, unused exports, orphans, long functions, complexity and duplication; warnings never fail a run, only new policy violations fail recognizer check",
      always_on: false,
      enabled: structure !== "off",
      runs_tests: false,
      limits: limitsOf(document, installed.keys),
      mark: checkMark(configured, structure !== "off"),
    },
    ...installed.sensors.map((sensor) => {
      const enabled =
        typeof registered === "object" &&
        registered !== null &&
        sensor.name in registered;

      return {
        id: sensor.name,
        display: sensor.display,
        description: sensor.description ?? "",
        always_on: false,
        enabled,
        runs_tests: sensor.runs_tests,
        limits: [],
        mark: checkMark(configured, enabled),
      };
    }),
    ...installed.describers.map((describer) => {
      const enabled = "describer" in document;

      return {
        id: describer.name,
        display: describer.display,
        description: describer.description ?? "",
        always_on: false,
        enabled,
        runs_tests: false,
        limits: [],
        mark: checkMark(configured, enabled),
      };
    }),
  ];
}

export function fixesOf(
  report: SetupDoctorReport,
  checks: readonly SurveyCheck[],
): SurveyFix[] {
  const offered = new Set(checks.map((check) => check.id));

  return report.areas
    .flatMap((area) => area.problems)
    .filter((problem) => problem.severity === "problem")
    .filter(
      (problem) =>
        !(
          problem.code === "unregistered-plugin" && offered.has(problem.subject)
        ),
    )
    .map((problem) => {
      const command = problem.fix.command;
      const runnable =
        command !== null &&
        commandRefusal(withoutRepository(splitCommand(command))) === null;

      return {
        code: problem.code,
        subject: problem.subject,
        title: problem.title,
        line: problem.line,
        fix_text: problem.fix.text,
        command: runnable ? command : null,
      };
    });
}

export function suitesOf(
  document: Document,
  files: string[],
  configured: boolean,
): SurveySuite[] {
  const list = document.tests;

  if (!configured || !Array.isArray(list)) {
    return [];
  }

  const text = (value: unknown) => (typeof value === "string" ? value : "");

  return list
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry),
    )
    .map((entry) => {
      const directory = normalizeDirectory(text(entry.directory) || ".");
      const root = directory === "." || directory === "./";
      const holds =
        root ||
        files.some(
          (file) => file === directory || file.startsWith(`${directory}/`),
        );
      const env =
        typeof entry.env === "object" &&
        entry.env !== null &&
        !Array.isArray(entry.env)
          ? Object.fromEntries(
              Object.entries(entry.env).filter(
                (pair): pair is [string, string] => typeof pair[1] === "string",
              ),
            )
          : undefined;

      return {
        name: text(entry.name),
        language: text(entry.language),
        directory: text(entry.directory) || ".",
        command: text(entry.command),
        ...(env === undefined || Object.keys(env).length === 0 ? {} : { env }),
        mark: holds ? ("set-up" as const) : ("gone" as const),
      };
    })
    .filter((suite) => suite.name !== "")
    .sort((a, b) => compareText(a.name, b.name));
}

export function markLanguages(
  languages: SurveyLanguage[],
  document: Document,
  suites: SurveySuite[],
  configured: boolean,
): SurveyLanguage[] {
  if (!configured) {
    return languages;
  }

  const scanners = document.scanners;
  const named = new Set<string>([
    ...suites.map((suite) => suite.language),
    ...(typeof scanners === "object" &&
    scanners !== null &&
    !Array.isArray(scanners)
      ? Object.keys(scanners)
      : []),
  ]);
  const present = new Set(languages.map((one) => one.language));
  const marked = languages.map((one) => ({
    ...one,
    mark: named.has(one.language) ? ("set-up" as const) : ("new" as const),
  }));
  const gone = [...named]
    .filter((language) => language !== "" && !present.has(language))
    .map((language) => ({
      language,
      files: 0,
      folders: [],
      mark: "gone" as const,
    }));

  return [...marked, ...gone].sort((a, b) =>
    compareText(a.language, b.language),
  );
}

export function policyOf(
  present: boolean,
  policy: readonly PolicyRule[] | null,
  repository: Repository | null,
): SurveyPolicy {
  if (policy === null || repository === null) {
    return { present, uncovered: [] };
  }

  const matchers = [
    ...PolicyRule.ignores(policy).map(
      (rule) => (id: string) => rule.ignores(id),
    ),
    ...PolicyRule.entries(policy).map((rule) => (id: string) => rule.marks(id)),
    ...PolicyRule.forbids(policy).flatMap((rule) =>
      [...rule.from, ...rule.to]
        .filter((glob) => !glob.startsWith("foreign:"))
        .map(compileGlob),
    ),
  ];
  const folders = new Map<string, boolean>();

  for (const file of repository.files) {
    const folder = folderOf(file.path);
    const covered = matchers.some((matches) => matches(file.path));

    folders.set(folder, (folders.get(folder) ?? false) || covered);
  }

  return {
    present,
    uncovered: [...folders]
      .filter(([, covered]) => !covered)
      .map(([folder]) => folder)
      .sort(compareText),
  };
}
