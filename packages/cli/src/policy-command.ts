import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseDocument } from "yaml";
import type { Io } from "./cli.js";
import { policyFile } from "./config.js";
import { emit } from "./config-edit.js";
import { publish } from "./config-keys.js";
import { InputError } from "./errors.js";
import {
  type KeyedCommand,
  keysHelp,
  runKeyed,
  save,
  usageFor,
} from "./key-command.js";
import { parsePolicy } from "./policy.js";
import { POLICY_KEYS } from "./policy-keys.js";
import { appendRules, migratePolicy } from "./policy-migrate.js";

const PUBLISHED = publish([POLICY_KEYS], "policy");

function errorsOf(text: string): string[] {
  if (text.trim() === "") {
    return [];
  }

  try {
    parsePolicy(text);

    return [];
  } catch (error) {
    if (error instanceof InputError) {
      return error.messages;
    }

    throw error;
  }
}

function introduced(original: string, text: string): string | null {
  const before = new Set(errorsOf(original));
  const added = errorsOf(text).filter((message) => !before.has(message));

  return added.length === 0 ? null : added.join("; ");
}

const POLICY: KeyedCommand = {
  noun: "policy",
  usage: usageFor("policy"),
  fileFor: policyFile,
  keysFor: () => PUBLISHED,
  validate: introduced,
  missing: "there is no policy at .recognizer/policy.yaml",
  schemaFor: null,
};

const FORBID_USAGE = [
  "usage: recognizer policy --migrate [--repository <dir>]",
  "       recognizer policy --add-forbid --from <glob> [--from <glob>...] --to <glob> [--to <glob>...] [--repository <dir>]",
];

function fileOf(repository: string | undefined): string {
  return policyFile(resolve(repository ?? "."));
}

function runMigrate(values: { repository?: string }, io: Io): number {
  const file = fileOf(values.repository);

  if (!io.exists(file)) {
    io.stderr(`recognizer policy: ${POLICY.missing}\n`);

    return 1;
  }

  const outcome = migratePolicy(io.readFile(file));

  if (outcome.status === "refused") {
    for (const message of outcome.messages) {
      io.stderr(`recognizer policy: ${message}\n`);
    }

    return 2;
  }

  if (outcome.changes.length === 0) {
    return 0;
  }

  save(io, file, outcome.text);
  io.stdout(`${outcome.changes.join("\n")}\n`);

  return 0;
}

function sameGlobs(value: unknown, globs: string[]): boolean {
  const items = Array.isArray(value) ? value : [value];

  return (
    items.length === globs.length &&
    items.every((item, at) => item === globs[at])
  );
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

  const file = fileOf(values.repository);
  const original = io.exists(file) ? io.readFile(file) : "";
  const doc = parseDocument(original);

  if (doc.errors.length > 0) {
    io.stderr(
      `recognizer policy: forbid: the policy is not valid YAML: ${doc.errors[0]?.message}\n`,
    );

    return 2;
  }

  if (doc.contents === null) {
    doc.contents = doc.createNode({}) as never;
  }

  const present = doc.toJS() as { forbid?: unknown } | null;
  const duplicate =
    Array.isArray(present?.forbid) &&
    present.forbid.some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        sameGlobs((entry as { from?: unknown }).from, from) &&
        sameGlobs((entry as { to?: unknown }).to, to),
    );

  if (duplicate) {
    return 0;
  }

  appendRules(doc, [{ from, to }]);

  const text = emit(doc, original);
  const invalid = introduced(original, text);

  if (invalid !== null) {
    io.stderr(`recognizer policy: forbid: ${invalid}\n`);

    return 2;
  }

  save(io, file, text);

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
