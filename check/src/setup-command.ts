import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import { surveyJson, surveyRepository } from "./setup-survey.js";

const USAGE = [
  "usage: recognizer setup survey [REPOSITORY] [--scan <file>] [--json]",
];

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

  throw new InputError(USAGE);
}
