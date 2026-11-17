import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import { buildChanges, type SetupChoices } from "./setup-changes.js";
import { surveyJson, surveyRepository } from "./setup-survey.js";

const USAGE = [
  "usage: recognizer setup survey [REPOSITORY] [--scan <file>] [--json]",
  "       recognizer setup changes [REPOSITORY] --choices <file> [--scan <file>] [--json]",
];

function readJsonFile(io: Io, file: string, flag: string): unknown {
  let text: string;

  try {
    text = io.readFile(resolve(file));
  } catch (error) {
    throw new InputError([
      `cannot read ${flag} file ${file}: ${(error as Error).message}`,
    ]);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new InputError([
      `${flag} file ${file} is not JSON: ${(error as Error).message}`,
    ]);
  }
}

function choicesOf(io: Io, file: string | undefined): SetupChoices {
  if (file === undefined) {
    throw new InputError(USAGE);
  }

  const value = readJsonFile(io, file, "--choices");

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InputError(["--choices must hold a JSON object"]);
  }

  return value as SetupChoices;
}

export async function runSetup(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      scan: { type: "string" },
      choices: { type: "string" },
      input: { type: "string" },
    },
  });
  const [verb, given, ...extra] = positionals;

  if (verb === undefined || extra.length > 0) {
    throw new InputError(USAGE);
  }

  const root = resolve(given ?? ".");
  const scan = values.scan === undefined ? {} : { scan: values.scan };

  if (verb === "survey") {
    if (values.choices !== undefined || values.input !== undefined) {
      throw new InputError(USAGE);
    }

    io.stdout(surveyJson(surveyRepository(io, root, scan)));

    return 0;
  }

  if (verb === "changes") {
    const choices = choicesOf(io, values.choices);
    const built = buildChanges(surveyRepository(io, root, scan), choices);

    io.stdout(`${JSON.stringify(built, null, 2)}\n`);

    return 0;
  }

  throw new InputError(USAGE);
}
