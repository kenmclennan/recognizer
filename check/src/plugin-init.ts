import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import {
  bundledTemplates,
  KINDS,
  LANGUAGES,
  NAME_MAX,
  NAME_PATTERN,
  programName,
  renderTemplates,
  type TemplateKind,
  type TemplateLanguage,
  type TemplateSet,
  templateValues,
} from "./plugin-templates.js";

const EXAMPLE =
  "recognizer plugin init --kind scanner --language python --name mylang ./recognizer-scan-mylang";

const USAGE =
  "usage: recognizer plugin init --kind <scanner|sensor|describer> --language <python|typescript|rust> --name <name> [folder]";

function refuseInput(problem: string, choices: string[]): never {
  throw new InputError([problem, ...choices, `example: ${EXAMPLE}`]);
}

function chosen<T extends string>(
  flag: string,
  value: string | undefined,
  choices: readonly T[],
): T {
  const listed = [`${flag} is one of: ${choices.join(", ")}`];

  if (value === undefined) {
    refuseInput(`${flag} is required`, [USAGE, ...listed]);
  }

  if (!choices.includes(value as T)) {
    refuseInput(`unknown ${flag} ${value}`, [USAGE, ...listed]);
  }

  return value as T;
}

function validName(value: string | undefined): string {
  const choices = [
    USAGE,
    `--name matches ${NAME_PATTERN.source} and is at most ${NAME_MAX} characters`,
  ];

  if (value === undefined) {
    refuseInput("--name is required", choices);
  }

  if (!NAME_PATTERN.test(value) || value.length > NAME_MAX) {
    refuseInput(`invalid --name ${JSON.stringify(value)}`, choices);
  }

  return value;
}

function firstEntry(io: Io, folder: string): string | null {
  if (!io.exists(folder)) {
    return null;
  }

  try {
    const [first] = io
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

export function runInit(
  argv: string[],
  io: Io,
  templates: TemplateSet = bundledTemplates(),
): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      kind: { type: "string" },
      language: { type: "string" },
      name: { type: "string" },
    },
  });

  if (positionals.length > 1) {
    refuseInput("only one folder may be given", [USAGE]);
  }

  const kind = chosen("--kind", values.kind, KINDS);
  const language = chosen("--language", values.language, LANGUAGES);
  const name = validName(values.name);
  const program = programName(kind, name);
  const folder = resolve(positionals[0] ?? ".");
  const files = renderTemplates(
    templates,
    language,
    kind,
    templateValues(kind, name),
  );
  const entry = firstEntry(io, folder);

  if (entry !== null) {
    io.stderr(
      entry === ""
        ? `recognizer plugin init: ${folder} is a file, not a folder\n`
        : `recognizer plugin init: ${folder} is not empty (it holds ${entry})\n`,
    );

    return 1;
  }

  for (const file of files) {
    io.writeFile(
      join(folder, file.path),
      file.content,
      file.executable ? 0o755 : undefined,
    );
  }

  io.stdout(
    `${[
      `wrote ${kind} ${name} in ${language} to ${folder}:`,
      ...files.map((file) => `  ${file.path}`),
      "",
      ...nextSteps(language, kind, name, program),
    ].join("\n")}\n`,
  );

  return 0;
}
