import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type ApplyEvent,
  type DoctorReport,
  discoverPlugins,
  type PlannedChange,
  Repository,
  recommendCards,
  rehearsalChanges,
  type SetupChoices,
  type SetupEntry,
  type SetupStop,
  type TryEvent,
} from "@recognizer/core";
import { PolicyAdapter } from "./adapters/filesystem/policy-adapter.js";
import { readUncheckedScanFile } from "./adapters/filesystem/scan-translator.js";
import { type Io, onStop } from "./cli.js";
import { configurationFor } from "./configuration-composition.js";
import { detectLanguages } from "./detect.js";
import { InputError } from "./errors.js";
import { manifestPorts } from "./manifest-ports.js";
import { buildRecord, entryFrom, type RunEntry, recordRun } from "./run-log.js";
import { readCachedRepository } from "./scan-command.js";
import { languageRulesOf } from "./scanners.js";

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

function stopFor(): { stop: SetupStop; release: () => void } {
  let requested = false;
  let handler: () => void = () => {};
  let finish: () => void = () => {};
  const done = new Promise<void>((resolveDone) => {
    finish = resolveDone;
  });
  const off = onStop(() => {
    requested = true;
    handler();

    return done;
  });

  return {
    stop: {
      requested: () => requested,
      onRequest: (next) => {
        handler = next;

        if (requested) {
          next();
        }
      },
      settled: () => finish(),
    },
    release: () => {
      finish();
      off();
    },
  };
}

function runEntry(entry: SetupEntry): RunEntry {
  return entryFrom(entry.name, {
    command: entry.command,
    status: entry.status,
    duration_ms: entry.durationMs,
    stderr: entry.output,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
  });
}

export async function runApply(
  io: Io,
  root: string,
  changes: PlannedChange[],
  emit: (event: ApplyEvent<DoctorReport>) => void,
  argv: string[] = [],
): Promise<boolean> {
  const startedAt = io.now();
  const entries: RunEntry[] = [];
  const { stop, release } = stopFor();

  try {
    const outcome = await configurationFor(io).applySetup({
      root,
      changes,
      stop,
      onEvent: emit,
      onEntry: (entry) => entries.push(runEntry(entry)),
    });

    if (outcome.status === "refused") {
      throw new InputError([outcome.reason.trimEnd()]);
    }

    recordRun(
      io,
      root,
      buildRecord(io, "setup", startedAt, undefined, argv, entries),
    );

    return outcome.ok;
  } finally {
    release();
  }
}

export async function runTry(
  io: Io,
  root: string,
  changes: PlannedChange[],
  emit: (event: TryEvent) => void,
): Promise<boolean> {
  const { stop, release } = stopFor();

  try {
    const outcome = await configurationFor(io).trySetup({
      root,
      changes,
      stop,
      onEvent: emit,
    });

    if (outcome.status === "refused") {
      throw new InputError([outcome.reason.trimEnd()]);
    }

    return outcome.ok;
  } finally {
    release();
  }
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
  const configuration = configurationFor(io);
  const scanOf = (file: string | undefined) =>
    file === undefined
      ? {}
      : { scan: readUncheckedScanFile(readJsonFile(io, file, "--scan")) };

  if (verb === "survey") {
    if (values.choices !== undefined || values.input !== undefined) {
      throw new InputError(USAGE);
    }

    const survey = await configuration.surveySetup({
      root,
      ...scanOf(values.scan),
    });

    io.stdout(`${JSON.stringify(survey, null, 2)}\n`);

    return 0;
  }

  if (verb === "changes") {
    const choices = choicesOf(io, values.choices);
    const { built } = await configuration.buildSetupChanges({
      root,
      choices,
      ...scanOf(values.scan),
    });

    io.stdout(`${JSON.stringify(built, null, 2)}\n`);

    return 0;
  }

  if (verb === "recommend") {
    if (values.input === undefined) {
      throw new InputError(USAGE);
    }

    const answer = recommendCards(
      new PolicyAdapter(io),
      root,
      readJsonFile(io, values.input, "--input"),
      scansFor(io, root, values.scan),
    );

    io.stdout(`${JSON.stringify(answer, null, 2)}\n`);

    return 0;
  }

  if (verb === "apply" || verb === "try") {
    const choices = choicesOf(io, values.choices);
    const { survey, built } = await configuration.buildSetupChanges({
      root,
      choices,
    });
    const emit = (event: unknown) => io.stdout(`${JSON.stringify(event)}\n`);
    const ok =
      verb === "apply"
        ? await runApply(io, root, built.changes, emit, argv)
        : await runTry(io, root, rehearsalChanges(survey, built.changes), emit);

    return ok ? 0 : 1;
  }

  throw new InputError(USAGE);
}
