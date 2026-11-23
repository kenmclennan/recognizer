import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { discoverPlugins, Repository } from "@recognizer/core";
import { readUncheckedScanFile } from "./adapters/filesystem/scan-translator.js";
import type { Io } from "./cli.js";
import { detectLanguages } from "./detect.js";
import { InputError } from "./errors.js";
import { manifestPorts } from "./manifest-ports.js";
import { readCachedRepository } from "./scan-command.js";
import { languageRulesOf } from "./scanners.js";
import { applyChanges } from "./setup-apply.js";
import { buildChanges, type SetupChoices } from "./setup-changes.js";
import { recommend } from "./setup-recommend.js";
import { surveyJson, surveyRepository } from "./setup-survey.js";
import { rehearsalChanges, tryChanges } from "./setup-try.js";

const USAGE = [
  "usage: recognizer setup survey [REPOSITORY] [--scan <file>] [--json]",
  "       recognizer setup changes [REPOSITORY] --choices <file> [--scan <file>] [--json]",
  "       recognizer setup recommend [REPOSITORY] --input <file> [--scan <file>] [--json]",
  "       recognizer setup apply [REPOSITORY] --choices <file>",
  "       recognizer setup try [REPOSITORY] --choices <file>",
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

function scansFor(io: Io, root: string, file: string | undefined): Repository {
  if (file !== undefined) {
    return readUncheckedScanFile(readJsonFile(io, file, "--scan"));
  }

  const rules = languageRulesOf(
    discoverPlugins(manifestPorts(io), ["scanner"]).plugins,
  );

  return Repository.join(
    detectLanguages(io, root, rules)
      .map((language) => readCachedRepository(io, root, language))
      .filter((part): part is Repository => part !== null),
  );
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

  if (verb === "recommend") {
    if (values.input === undefined) {
      throw new InputError(USAGE);
    }

    const answer = recommend(
      io,
      root,
      readJsonFile(io, values.input, "--input"),
      scansFor(io, root, values.scan),
    );

    io.stdout(`${JSON.stringify(answer, null, 2)}\n`);

    return 0;
  }

  if (verb === "apply") {
    const choices = choicesOf(io, values.choices);
    const { changes } = buildChanges(surveyRepository(io, root), choices);
    const ok = await applyChanges(
      io,
      root,
      changes,
      (event) => io.stdout(`${JSON.stringify(event)}\n`),
      argv,
    );

    return ok ? 0 : 1;
  }

  if (verb === "try") {
    const choices = choicesOf(io, values.choices);
    const survey = surveyRepository(io, root);
    const { changes } = buildChanges(survey, choices);
    const ok = await tryChanges(
      io,
      root,
      rehearsalChanges(survey, changes),
      (event) => io.stdout(`${JSON.stringify(event)}\n`),
      argv,
    );

    return ok ? 0 : 1;
  }

  throw new InputError(USAGE);
}
