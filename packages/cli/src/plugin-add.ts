import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import type { Io } from "./cli.js";
import { configFile } from "./config.js";
import {
  addSection,
  addValue,
  type EditOutcome,
  setValue,
} from "./config-edit.js";
import { CORE_KEYS, publish } from "./config-keys.js";
import { InputError } from "./errors.js";
import {
  findOnPath,
  programName,
  unsupportedMessage,
} from "./plugin-discovery.js";
import {
  judgeProtocol,
  type Manifest,
  type PluginKind,
  readManifest,
} from "./plugin-manifest.js";
import { SHIPPED_SENSORS } from "./shipped-sensors.js";

const USAGE = [
  "usage: recognizer plugin add <name> [--kind sensor|describer] [--repository <dir>]",
];

type Registrable = "sensor" | "describer";

interface Existing {
  sensors: Record<string, unknown>;
  describerProgram: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function existingOf(text: string): Existing {
  let document: unknown;

  try {
    document = parse(text);
  } catch {
    document = null;
  }

  const record = isRecord(document) ? document : {};
  const command = isRecord(record.describer)
    ? record.describer.command
    : undefined;

  return {
    sensors: isRecord(record.sensors) ? record.sensors : {},
    describerProgram:
      Array.isArray(command) && typeof command[0] === "string"
        ? command[0]
        : undefined,
  };
}

function locate(
  io: Io,
  name: string,
  kind: Registrable | undefined,
): { kind: Registrable; program: string; path: string } {
  const kinds: Registrable[] =
    kind === undefined ? ["sensor", "describer"] : [kind];
  const found = kinds.flatMap((one) => {
    const program = programName(one, name);
    const path = findOnPath(io, program);

    return path === null ? [] : [{ kind: one, program, path }];
  });

  if (found.length > 1) {
    throw new InputError([
      `${name} is both a sensor and a describer: give --kind sensor or --kind describer`,
    ]);
  }

  if (found.length === 1) {
    return found[0] as (typeof found)[number];
  }

  const scanner = programName("scanner", name);

  if (kind === undefined && findOnPath(io, scanner) !== null) {
    throw new InputError([
      `${name} is a scanner, and scanners are never registered: choose it for a language with recognizer config scanners.<language> ${name}`,
    ]);
  }

  throw new InputError([
    `${kinds.map((one) => programName(one, name)).join(" or ")} was not found on PATH`,
  ]);
}

function unwrap(outcome: EditOutcome, text: string): string {
  if (outcome.status === "refused") {
    throw new Refused(outcome.reason);
  }

  return outcome.status === "ok" ? outcome.text : text;
}

class Refused extends Error {}

function sensorWords(program: string): string[] {
  return [
    program,
    "run",
    "--repository",
    "{repository}",
    "--commit",
    "{commit}",
    "--output",
    "{output}",
  ];
}

function describerWords(program: string): string[] {
  return [program, "run", "--model", "{model}", "{request}"];
}

function edited(
  original: string,
  existing: Existing,
  kind: Registrable,
  name: string,
  program: string,
  manifest: Manifest,
): { text: string; registered: boolean } {
  const published = publish([CORE_KEYS], "config");
  let text = original;

  const registered =
    kind === "sensor"
      ? existing.sensors[name] !== undefined && existing.sensors[name] !== null
      : existing.describerProgram === program;

  if (!registered) {
    if (kind === "sensor" && SHIPPED_SENSORS.includes(name)) {
      text = unwrap(addSection(text, published, `sensors.${name}`), text);
    } else if (kind === "sensor") {
      for (const word of sensorWords(program)) {
        text = unwrap(
          addValue(text, published, `sensors.${name}.command`, word),
          text,
        );
      }
    } else {
      for (const word of describerWords(program)) {
        text = unwrap(
          addValue(text, published, "describer.command", word),
          text,
        );
      }

      text = unwrap(
        setValue(
          text,
          published,
          "describer.version",
          manifest.prompt_version as string,
        ),
        text,
      );
    }
  }

  text = unwrap(
    setValue(text, published, `install.${program}`, manifest.install),
    text,
  );

  return { text, registered };
}

export function runAdd(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { kind: { type: "string" }, repository: { type: "string" } },
  });
  const [name] = positionals;

  if (
    name === undefined ||
    positionals.length > 1 ||
    (values.kind !== undefined &&
      values.kind !== "sensor" &&
      values.kind !== "describer")
  ) {
    throw new InputError(USAGE);
  }

  const target = locate(io, name, values.kind as Registrable | undefined);
  const read = readManifest(io, target.path);

  if (!read.ok) {
    io.stderr(`recognizer plugin add: ${read.reason}\n`);

    return 1;
  }

  const { manifest } = read;
  const kind: PluginKind = target.kind;

  if (manifest.kind !== kind || manifest.name !== name) {
    io.stderr(
      `recognizer plugin add: ${target.path} manifest names a ${manifest.kind} called ${manifest.name}, not the ${kind} ${name}\n`,
    );

    return 1;
  }

  const judgement = judgeProtocol(manifest);

  if (judgement === "unsupported") {
    io.stderr(
      `recognizer plugin add: ${unsupportedMessage({ kind, name, manifest })}\n`,
    );

    return 1;
  }

  if (kind === "describer" && manifest.prompt_version === undefined) {
    io.stderr(
      `recognizer plugin add: ${target.program} manifest has no prompt_version\n`,
    );

    return 1;
  }

  const root = resolve(values.repository ?? ".");
  const file = configFile(root);
  const original = io.exists(file) ? io.readFile(file) : "";
  const existing = existingOf(original);

  if (
    kind === "describer" &&
    existing.describerProgram !== undefined &&
    existing.describerProgram !== target.program
  ) {
    throw new InputError([
      `${existing.describerProgram} is already the registered describer: remove it with recognizer config --unset describer.command before registering ${target.program}`,
    ]);
  }

  let result: { text: string; registered: boolean };

  try {
    result = edited(
      original,
      existing,
      target.kind,
      name,
      target.program,
      manifest,
    );
  } catch (error) {
    if (error instanceof Refused) {
      io.stderr(`recognizer plugin add: ${error.message}\n`);

      return 1;
    }

    throw error;
  }

  if (judgement === "previous") {
    io.stderr(
      `recognizer plugin add: ${target.program} speaks the previous protocol ${manifest.protocol}: install ${manifest.install}\n`,
    );
  }

  if (result.text !== original || !io.exists(file)) {
    const temporary = `${file}.${io.pid()}.tmp`;

    io.writeFile(temporary, result.text);
    io.rename(temporary, file);
  }

  io.stdout(
    result.registered
      ? `${target.program}: already registered\n`
      : `${target.program}: registered as ${kind === "sensor" ? `sensors.${name}` : "describer"}\n`,
  );

  return 0;
}
