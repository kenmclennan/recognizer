import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { configFile } from "./config.js";
import {
  addSection,
  addValue,
  type EditOutcome,
  listKeys,
  readKey,
  removeSection,
  setValue,
  unsetValue,
} from "./config-edit.js";
import {
  describeConstraints,
  loadKeys,
  notAnsweringLine,
  type PublishedKeys,
} from "./config-keys.js";
import { InputError } from "./errors.js";

const USAGE = [
  "usage: recognizer config <key> <value>",
  "       recognizer config --add <key> <value>",
  "       recognizer config --get <key>",
  "       recognizer config --list",
  "       recognizer config --unset <key> [<value>]",
  "       recognizer config --remove-section <section>",
  "       recognizer config --add-section <section>",
  "       each takes [--repository <dir>]; `--` ends the options",
];

function temporaryFor(file: string, io: Io): string {
  return `${file}.${io.pid()}.tmp`;
}

function refusal(
  io: Io,
  published: PublishedKeys,
  key: string,
  reason: string,
): number {
  const suffix =
    published.notAnswering !== null &&
    /^no such key|is not a valid/.test(reason)
      ? `; ${notAnsweringLine(published.notAnswering)}`
      : "";

  io.stderr(`recognizer config: ${key}: ${reason}${suffix}\n`);

  return 2;
}

function save(io: Io, file: string, text: string): void {
  const temporary = temporaryFor(file, io);

  io.writeFile(temporary, text);
  io.rename(temporary, file);
}

function finish(
  io: Io,
  published: PublishedKeys,
  file: string,
  key: string,
  original: string,
  outcome: EditOutcome,
  absent: number,
): number {
  if (outcome.status === "refused") {
    return refusal(io, published, key, outcome.reason);
  }

  if (outcome.status === "absent") {
    return absent;
  }

  if (outcome.text !== original || !io.exists(file)) {
    save(io, file, outcome.text);
  }

  return 0;
}

export function runConfig(argv: string[], io: Io): number {
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
    },
  });
  const verbs = (
    ["add", "get", "list", "unset", "remove-section", "add-section"] as const
  ).filter((verb) => values[verb] === true);

  if (verbs.length > 1) {
    throw new InputError(USAGE);
  }

  const verb = verbs[0] ?? "set";
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
    throw new InputError(USAGE);
  }

  const root = resolve(values.repository ?? ".");
  const file = configFile(root);
  const published = loadKeys(io, root);
  const original = io.exists(file) ? io.readFile(file) : "";
  const key = first as string;

  if (verb === "list") {
    const listing = listKeys(original, published);

    if (listing.lines.length > 0) {
      io.stdout(`${listing.lines.join("\n")}\n`);
    }

    if (listing.skipped.length === 0) {
      return 0;
    }

    const why =
      published.notAnswering === null
        ? ""
        : `: ${notAnsweringLine(published.notAnswering)}`;

    for (const path of listing.skipped) {
      io.stderr(`recognizer config: ${path}: cannot be addressed${why}\n`);
    }

    return 1;
  }

  if (verb === "get") {
    const outcome = readKey(original, published, key);

    if (outcome.status === "refused") {
      return refusal(io, published, key, outcome.reason);
    }

    if (outcome.status === "absent") {
      return 1;
    }

    io.stdout(`${outcome.lines.join("\n")}\n`);

    return 0;
  }

  const outcome =
    verb === "set"
      ? setValue(original, published, key, second as string)
      : verb === "add"
        ? addValue(original, published, key, second as string)
        : verb === "unset"
          ? unsetValue(original, published, key, second)
          : verb === "remove-section"
            ? removeSection(original, published, key)
            : addSection(original, published, key);

  return finish(
    io,
    published,
    file,
    key,
    original,
    outcome,
    verb === "unset" || verb === "remove-section" ? 1 : 0,
  );
}

export function configKeysHelp(io: Io, root: string): string {
  const published = loadKeys(io, root);
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
      `      example: recognizer config ${example}`,
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
    lines.push("", notAnsweringLine(published.notAnswering));
  }

  return `${lines.join("\n")}\n`;
}
