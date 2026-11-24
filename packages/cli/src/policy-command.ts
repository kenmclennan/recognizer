import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { POLICY_KEYS, publish } from "@recognizer/core";
import type { Io } from "./cli.js";
import { configurationFor } from "./configuration-composition.js";
import { asInputError, InputError } from "./errors.js";
import {
  type KeyedCommand,
  keysHelp,
  runKeyed,
  usageFor,
} from "./key-command.js";

const PUBLISHED = publish([POLICY_KEYS], "policy");

const POLICY: KeyedCommand = {
  noun: "policy",
  usage: usageFor("policy"),
  schema: false,
};

const FORBID_USAGE = [
  "usage: recognizer policy --migrate [--repository <dir>]",
  "       recognizer policy --add-forbid --from <glob> [--from <glob>...] --to <glob> [--to <glob>...] [--repository <dir>]",
];

function rootOf(repository: string | undefined): string {
  return resolve(repository ?? ".");
}

function runMigrate(values: { repository?: string }, io: Io): number {
  const outcome = configurationFor(io).migratePolicy({
    root: rootOf(values.repository),
  });

  if (outcome.status === "missing") {
    io.stderr(`recognizer policy: ${outcome.reason}\n`);

    return 1;
  }

  if (outcome.status === "refused") {
    for (const message of outcome.messages) {
      io.stderr(`recognizer policy: ${message}\n`);
    }

    return 2;
  }

  if (outcome.status === "migrated") {
    io.stdout(`${outcome.changes.join("\n")}\n`);
  }

  return 0;
}

function runAddForbid(
  values: { repository?: string; from?: string[]; to?: string[] },
  io: Io,
): number {
  const from = values.from ?? [];
  const to = values.to ?? [];

  if (
    from.length === 0 ||
    to.length === 0 ||
    [...from, ...to].some((glob) => glob.trim() === "")
  ) {
    throw new InputError(FORBID_USAGE);
  }

  const outcome = asInputError(() =>
    configurationFor(io).addForbid({
      root: rootOf(values.repository),
      from,
      to,
    }),
  );

  if (outcome.status === "invalid-yaml") {
    io.stderr(
      `recognizer policy: forbid: the policy is not valid YAML: ${outcome.message}\n`,
    );

    return 2;
  }

  if (outcome.status === "refused") {
    io.stderr(`recognizer policy: forbid: ${outcome.reason}\n`);

    return 2;
  }

  return 0;
}

export function runPolicy(argv: string[], io: Io): number {
  if (!argv.includes("--migrate") && !argv.includes("--add-forbid")) {
    return runKeyed(POLICY, argv, io);
  }

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      migrate: { type: "boolean" },
      "add-forbid": { type: "boolean" },
      from: { type: "string", multiple: true },
      to: { type: "string", multiple: true },
      repository: { type: "string" },
    },
  });

  if (positionals.length > 0 || values.migrate === values["add-forbid"]) {
    throw new InputError(FORBID_USAGE);
  }

  if (values.migrate === true) {
    if (values.from !== undefined || values.to !== undefined) {
      throw new InputError(FORBID_USAGE);
    }

    return runMigrate(values, io);
  }

  return runAddForbid(values, io);
}

export function policyKeysHelp(): string {
  return keysHelp(POLICY, PUBLISHED);
}
