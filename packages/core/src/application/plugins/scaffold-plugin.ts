import { InvalidRequest } from "../../domain/invalid-request.js";
import { joinPath } from "../../domain/path.js";
import { KINDS, programName } from "../../domain/plugins/installed-plugin.js";
import type { PluginFacts } from "../../domain/plugins/manifest.js";
import type { PluginPorts } from "./internal/plugin-ports.js";

export const LANGUAGES = ["python", "typescript", "rust"] as const;

export type TemplateKind = (typeof KINDS)[number];

export type TemplateLanguage = (typeof LANGUAGES)[number];

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

const EXAMPLE =
  "recognizer plugin init --kind scanner --language python --name mylang ./recognizer-scan-mylang";

const USAGE =
  "usage: recognizer plugin init --kind <scanner|sensor|describer> --language <python|typescript|rust> --name <name> [folder]";

export function refuseScaffold(problem: string, choices: string[]): never {
  throw new InvalidRequest([problem, ...choices, `example: ${EXAMPLE}`]);
}

function chosen<T extends string>(
  flag: string,
  value: string | undefined,
  choices: readonly T[],
): T {
  const listed = [`${flag} is one of: ${choices.join(", ")}`];

  if (value === undefined) {
    refuseScaffold(`${flag} is required`, [USAGE, ...listed]);
  }

  if (!choices.includes(value as T)) {
    refuseScaffold(`unknown ${flag} ${value}`, [USAGE, ...listed]);
  }

  return value as T;
}

function validName(value: string | undefined): string {
  const choices = [
    USAGE,
    `--name matches ${NAME_PATTERN.source} and is at most ${NAME_MAX} characters`,
  ];

  if (value === undefined) {
    refuseScaffold("--name is required", choices);
  }

  if (!NAME_PATTERN.test(value) || value.length > NAME_MAX) {
    refuseScaffold(`invalid --name ${JSON.stringify(value)}`, choices);
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
  language: TemplateLanguage,
  kind: TemplateKind,
  name: string,
  program: string,
): string[] {
  const command =
    language === "rust" ? `target/debug/${program}` : `./${program}`;
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
    ...(language === "rust" ? ["  - build it: cargo build"] : []),
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
  const kind = chosen("--kind", request.kind, KINDS);
  const language = chosen("--language", request.language, LANGUAGES);
  const name = validName(request.name);
  const program = programName(kind, name);
  const { folder } = request;
  const files = renderTemplates(
    ports.templates.bundled(),
    language,
    kind,
    templateValues(kind, name, ports.validators.facts),
  );
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
      ...nextSteps(language, kind, name, program),
    ].join("\n")}\n`,
  };
}
