import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  describeConstraints,
  type EditKeyOutcome,
  type KeyVerb,
  type PublishedKeys,
} from "@recognizer/core";
import type { Io } from "./cli.js";
import { configurationFor } from "./configuration-composition.js";
import { asInputError, InputError } from "./errors.js";

export interface KeyedCommand {
  noun: "config" | "policy";
  usage: string[];
  schema: boolean;
}

export function usageFor(noun: string, schema = false): string[] {
  return [
    `usage: recognizer ${noun} <key> <value>`,
    `       recognizer ${noun} --add <key> <value>`,
    `       recognizer ${noun} --get <key>`,
    `       recognizer ${noun} --list`,
    `       recognizer ${noun} --unset <key> [<value>]`,
    `       recognizer ${noun} --remove-section <section>`,
    `       recognizer ${noun} --add-section <section>`,
    ...(schema ? [`       recognizer ${noun} --schema`] : []),
    "       each takes [--repository <dir>]; `--` ends the options",
  ];
}

function printOutcome(
  command: KeyedCommand,
  io: Io,
  verb: KeyVerb,
  outcome: EditKeyOutcome,
): number {
  if (outcome.status === "missing") {
    io.stderr(`recognizer ${command.noun}: ${outcome.reason}\n`);

    return 1;
  }

  if (outcome.status === "refused") {
    io.stderr(
      `recognizer ${command.noun}: ${outcome.key}: ${outcome.reason}${outcome.suffix}\n`,
    );

    return 2;
  }

  if (outcome.status === "absent") {
    return verb === "get" || verb === "unset" || verb === "remove-section"
      ? 1
      : 0;
  }

  if (verb === "get" || outcome.lines.length > 0) {
    io.stdout(`${outcome.lines.join("\n")}\n`);
  }

  if (outcome.status === "skipped") {
    for (const path of outcome.paths) {
      io.stderr(
        `recognizer ${command.noun}: ${path}: cannot be addressed${outcome.why}\n`,
      );
    }

    return 1;
  }

  return 0;
}

function printSchema(
  command: KeyedCommand,
  values: Record<string, unknown>,
  positionals: string[],
  io: Io,
): number {
  const others = Object.keys(values).filter(
    (name) => name !== "schema" && name !== "repository",
  );

  if (!command.schema || others.length > 0 || positionals.length > 0) {
    throw new InputError(command.usage);
  }

  const read = configurationFor(io).readKeySchema();

  if (read.status === "not-answering") {
    for (const line of read.lines) {
      io.stderr(`recognizer ${command.noun}: ${line}\n`);
    }

    return 1;
  }

  io.stdout(`${JSON.stringify(read.schema, null, 2)}\n`);

  return 0;
}

export function runKeyed(
  command: KeyedCommand,
  argv: string[],
  io: Io,
): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      add: { type: "boolean" },
      get: { type: "boolean" },
      list: { type: "boolean" },
      unset: { type: "boolean" },
      "remove-section": { type: "boolean" },
      "add-section": { type: "boolean" },
      repository: { type: "string" },
      schema: { type: "boolean" },
    },
  });

  if (values.schema === true) {
    return printSchema(command, values, positionals, io);
  }

  const verbs = (
    ["add", "get", "list", "unset", "remove-section", "add-section"] as const
  ).filter((verb) => values[verb] === true);

  if (verbs.length > 1) {
    throw new InputError(command.usage);
  }

  const verb = (verbs[0] ?? "set") as (typeof verbs)[number] | "set";
  const [first, second, ...extra] = positionals;
  const count = positionals.length;
  const fits =
    (verb === "set" && count === 2) ||
    (verb === "add" && count === 2) ||
    (verb === "get" && count === 1) ||
    (verb === "list" && count === 0) ||
    (verb === "unset" && (count === 1 || count === 2)) ||
    (verb === "remove-section" && count === 1) ||
    (verb === "add-section" && count === 1);

  if (!fits || extra.length > 0) {
    throw new InputError(command.usage);
  }

  const outcome = asInputError(() =>
    configurationFor(io).editKey({
      subject: command.noun,
      root: resolve(values.repository ?? "."),
      verb,
      key: first ?? "",
      ...(second === undefined ? {} : { value: second }),
    }),
  );

  return printOutcome(command, io, verb, outcome);
}

export function keysHelp(
  command: KeyedCommand,
  published: PublishedKeys,
): string {
  const lines = ["Keys:"];

  const block = (
    head: string,
    owner: string,
    description: string,
    example: string,
  ) => {
    lines.push(
      `  ${head}  [${owner}]`,
      `      ${description}`,
      `      example: recognizer ${command.noun} ${example}`,
    );
  };

  for (const section of published.sections) {
    block(
      section.key,
      section.owner,
      `a section (${section.shape}): ${section.description}`,
      section.example,
    );
  }

  for (const entry of published.keys) {
    block(
      entry.key,
      entry.owner,
      `${describeConstraints(entry)}: ${entry.description}`,
      entry.example,
    );
  }

  if (published.notAnswering !== null) {
    lines.push("", published.notAnswering);
  }

  return `${lines.join("\n")}\n`;
}
