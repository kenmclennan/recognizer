import { InvalidRequest } from "../../domain/invalid-request.js";
import { joinPath } from "../../domain/path.js";
import { KINDS, programName } from "../../domain/plugins/installed-plugin.js";
import type { PluginFacts } from "../../domain/plugins/manifest.js";
import type { PluginPorts } from "./internal/plugin-ports.js";

export type TemplateKind = (typeof KINDS)[number];

export type TemplateLanguage = string;

export const LANGUAGE_FILE = "language.json";

export const PROGRAM_FILE = "{{program}}";

export const TEMPLATE_SUFFIX = ".tmpl";

export const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export const NAME_MAX = 64;

export interface TemplateValues {
  name: string;
  program: string;
  kind: string;
  protocol: string;
  scan_schema_version: string;
  findings_version: string;
}

export interface RenderedFile {
  path: string;
  content: string;
  executable: boolean;
}

export type TemplateSet = Record<string, string>;

export function templateValues(
  kind: TemplateKind,
  name: string,
  facts: PluginFacts,
): TemplateValues {
  return {
    name,
    program: programName(kind, name),
    kind,
    protocol: String(facts.protocol),
    scan_schema_version: String(facts.scanSchemaVersion),
    findings_version: String(facts.findingsVersion),
  };
}

function substitute(text: string, values: TemplateValues, where: string) {
  const known = new Set(Object.keys(values));
  const replaced = text.replace(/\{\{([^{}]*)\}\}/g, (whole, placeholder) => {
    if (!known.has(placeholder)) {
      throw new Error(`${where} names an unknown placeholder ${whole}`);
    }

    return values[placeholder as keyof TemplateValues];
  });

  if (replaced.includes("{{")) {
    throw new Error(`${where} still holds {{ after rendering`);
  }

  return replaced;
}

export interface LanguageFacts {
  order: number;
  launch?: string;
  build?: string;
}

const LANGUAGE_MEMBERS = new Set(["order", "launch", "build"]);

function languageFacts(set: TemplateSet, language: string): LanguageFacts {
  const key = `${language}/${LANGUAGE_FILE}`;
  let parsed: unknown;

  try {
    parsed = JSON.parse(set[key] as string);
  } catch {
    throw new Error(`${key} is not JSON`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${key} is not an object`);
  }

  const facts = parsed as Record<string, unknown>;

  if (!Number.isInteger(facts.order)) {
    throw new Error(`${key} lacks an integer order`);
  }

  for (const member of Object.keys(facts)) {
    if (!LANGUAGE_MEMBERS.has(member)) {
      throw new Error(`${key} holds an unknown member ${member}`);
    }
  }

  for (const member of ["launch", "build"]) {
    if (member in facts && typeof facts[member] !== "string") {
      throw new Error(`${key} member ${member} is not a string`);
    }
  }

  return facts as unknown as LanguageFacts;
}

export function templateLanguages(set: TemplateSet): string[] {
  const suffix = `/${LANGUAGE_FILE}`;

  return Object.keys(set)
    .filter(
      (key) =>
        key.endsWith(suffix) && key.indexOf("/") === key.length - suffix.length,
    )
    .map((key) => key.slice(0, -suffix.length))
    .map((language) => ({
      language,
      order: languageFacts(set, language).order,
    }))
    .sort(
      (left, right) =>
        left.order - right.order ||
        (left.language < right.language
          ? -1
          : left.language > right.language
            ? 1
            : 0),
    )
    .map((entry) => entry.language);
}

export function renderTemplates(
  set: TemplateSet,
  language: TemplateLanguage,
  kind: TemplateKind,
  values: TemplateValues,
): RenderedFile[] {
  const prefix = `${language}/${kind}/`;

  return Object.keys(set)
    .filter((key) => key.startsWith(prefix))
    .sort()
    .map((key) => {
      const relative = key.slice(prefix.length);
      const written = relative.endsWith(TEMPLATE_SUFFIX)
        ? relative.slice(0, -TEMPLATE_SUFFIX.length)
        : relative;

      return {
        path: substitute(written, values, key),
        content: substitute(set[key] as string, values, key),
        executable: relative === PROGRAM_FILE,
      };
    });
}

function exampleOf(languages: readonly string[]): string {
  return `recognizer plugin init --kind scanner --language ${languages[0]} --name mylang ./recognizer-scan-mylang`;
}

function usageOf(languages: readonly string[]): string {
  return `usage: recognizer plugin init --kind <scanner|sensor|describer> --language <${languages.join("|")}> --name <name> [folder]`;
}

export function refuseScaffold(
  problem: string,
  choices: string[],
  languages: readonly string[],
): never {
  throw new InvalidRequest([
    problem,
    ...choices,
    `example: ${exampleOf(languages)}`,
  ]);
}

function chosen<T extends string>(
  flag: string,
  value: string | undefined,
  choices: readonly T[],
  languages: readonly string[],
): T {
  const listed = [`${flag} is one of: ${choices.join(", ")}`];
  const usage = usageOf(languages);

  if (value === undefined) {
    refuseScaffold(`${flag} is required`, [usage, ...listed], languages);
  }

  if (!choices.includes(value as T)) {
    refuseScaffold(`unknown ${flag} ${value}`, [usage, ...listed], languages);
  }

  return value as T;
}

function validName(
  value: string | undefined,
  languages: readonly string[],
): string {
  const choices = [
    usageOf(languages),
    `--name matches ${NAME_PATTERN.source} and is at most ${NAME_MAX} characters`,
  ];

  if (value === undefined) {
    refuseScaffold("--name is required", choices, languages);
  }

  if (!NAME_PATTERN.test(value) || value.length > NAME_MAX) {
    refuseScaffold(
      `invalid --name ${JSON.stringify(value)}`,
      choices,
      languages,
    );
  }

  return value;
}

function firstEntry(
  ports: Pick<PluginPorts, "sandbox">,
  folder: string,
): string | null {
  if (!ports.sandbox.exists(folder)) {
    return null;
  }

  try {
    const [first] = ports.sandbox
      .readDir(folder)
      .map((entry) => entry.name)
      .sort();

    return first ?? null;
  } catch {
    return "";
  }
}

function nextSteps(
  facts: { launch: string; build: string | null },
  kind: TemplateKind,
  name: string,
  program: string,
): string[] {
  const command = facts.launch;
  const request =
    kind === "describer" ? " --request <a request file, as in the README>" : "";
  const choose =
    kind === "scanner"
      ? [
          `  - only if two installed scanners claim the language ${name}: recognizer config scanners.${name} ${name}`,
        ]
      : [`  - register it in a repository: recognizer plugin add ${name}`];

  return [
    "next:",
    ...(facts.build === null ? [] : [`  - build it: ${facts.build}`]),
    `  - check it: recognizer plugin check ${command}${request}`,
    `  - put ${program} on PATH (the README explains the three ways)`,
    ...choose,
    "  - read the guide: recognizer help plugin-guide",
  ];
}

export interface ScaffoldRequest {
  kind: string | undefined;
  language: string | undefined;
  name: string | undefined;
  folder: string;
}

export type ScaffoldResult =
  | { status: "failed"; message: string }
  | { status: "done"; text: string };

export function scaffoldPlugin(
  ports: Pick<PluginPorts, "sandbox" | "templates" | "validators">,
  request: ScaffoldRequest,
): ScaffoldResult {
  const set = ports.templates.bundled();
  const languages = templateLanguages(set);
  const kind = chosen("--kind", request.kind, KINDS, languages);
  const language = chosen("--language", request.language, languages, languages);
  const name = validName(request.name, languages);
  const program = programName(kind, name);
  const { folder } = request;
  const values = templateValues(kind, name, ports.validators.facts);
  const files = renderTemplates(set, language, kind, values);
  const facts = languageFacts(set, language);
  const where = `${language}/${LANGUAGE_FILE}`;
  const entry = firstEntry(ports, folder);

  if (entry !== null) {
    return {
      status: "failed",
      message:
        entry === ""
          ? `${folder} is a file, not a folder`
          : `${folder} is not empty (it holds ${entry})`,
    };
  }

  for (const file of files) {
    ports.sandbox.writeFile(
      joinPath(folder, file.path),
      file.content,
      file.executable ? 0o755 : undefined,
    );
  }

  return {
    status: "done",
    text: `${[
      `wrote ${kind} ${name} in ${language} to ${folder}:`,
      ...files.map((file) => `  ${file.path}`),
      "",
      ...nextSteps(
        {
          launch: substitute(
            facts.launch ?? `./${PROGRAM_FILE}`,
            values,
            where,
          ),
          build:
            facts.build === undefined
              ? null
              : substitute(facts.build, values, where),
        },
        kind,
        name,
        program,
      ),
    ].join("\n")}\n`,
  };
}
