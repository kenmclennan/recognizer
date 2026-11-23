import { resolve } from "node:path";
import {
  findViolations,
  type PolicyRule,
  type Repository,
} from "@recognizer/core";
import { parse, stringify } from "yaml";
import { parsePolicy } from "./adapters/filesystem/policy-translator.js";
import type { Io } from "./cli.js";
import { policyFile } from "./config.js";
import { InputError } from "./errors.js";
import {
  type DroppedCard,
  type ForbidCard,
  type PolicyCard,
  parseCard,
  type Recommendation,
  summaryOf,
} from "./setup-cards.js";

export * from "./setup-cards.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function policyDocument(text: string | null): Record<string, unknown> {
  if (text === null || text.trim() === "") {
    return {};
  }

  try {
    const value: unknown = parse(text);

    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function sameList(a: unknown, b: string[]): boolean {
  const items = listOf(a);

  return items.length === b.length && items.every((item, at) => item === b[at]);
}

function forbidPresent(
  document: Record<string, unknown>,
  from: string[],
  to: string[],
): boolean {
  return listOf(document.forbid).some((entry) => {
    if (typeof entry === "string") {
      const [left, right] = entry.split("->").map((part) => part.trim());

      return (
        from.length === 1 &&
        to.length === 1 &&
        left === from[0] &&
        right === to[0]
      );
    }

    return (
      isRecord(entry) && sameList(entry.from, from) && sameList(entry.to, to)
    );
  });
}

function alreadyPresent(
  card: PolicyCard,
  document: Record<string, unknown>,
): boolean {
  if (card.kind === "ignore") {
    const present = listOf(document.ignore);

    return card.globs.every((glob) => present.includes(glob));
  }

  if (card.kind === "entry") {
    const present = listOf(document.entry);

    return card.paths.every((path) => present.includes(path));
  }

  return (
    forbidPresent(document, card.from, card.to) &&
    (!card.both || forbidPresent(document, card.to, card.from))
  );
}

function refusalOf(card: PolicyCard): string | null {
  const body =
    card.kind === "ignore"
      ? { ignore: card.globs }
      : card.kind === "entry"
        ? { entry: card.paths }
        : {
            forbid: [
              { from: card.from, to: card.to },
              ...(card.both ? [{ from: card.to, to: card.from }] : []),
            ],
          };

  try {
    parsePolicy(stringify(body));

    return null;
  } catch (error) {
    return error instanceof InputError
      ? error.messages.join("; ")
      : (error as Error).message;
  }
}

function policyOf(
  document: Record<string, unknown>,
  forbid: unknown[],
): PolicyRule[] {
  return parsePolicy(
    stringify({
      ...(document.ignore === undefined ? {} : { ignore: document.ignore }),
      forbid,
    }),
  );
}

function todayFor(
  card: ForbidCard,
  document: Record<string, unknown>,
  repository: Repository,
): { count: number; example: string | null } {
  const directions = [{ from: card.from, to: card.to }];

  if (card.both) {
    directions.push({ from: card.to, to: card.from });
  }

  const policy = policyOf(document, directions);
  let count = 0;
  let example: string | null = null;

  for (const violation of findViolations(repository, policy)) {
    for (const one of violation.dependencies) {
      count += 1;
      example ??= `${violation.file} -> ${one.to}`;
    }
  }

  return { count, example };
}

export function recommend(
  io: Io,
  given: string,
  input: unknown,
  repository: Repository,
): Recommendation {
  const root = resolve(given);

  if (!isRecord(input) || !Array.isArray(input.entries)) {
    throw new InputError(["the recommendation has no entries list"]);
  }

  const file = policyFile(root);
  const document = policyDocument(io.exists(file) ? io.readFile(file) : null);
  const entries: PolicyCard[] = [];
  const dropped: DroppedCard[] = [];

  input.entries.forEach((raw: unknown, index: number) => {
    const card = parseCard(raw);

    if (card === null) {
      throw new InputError([`entry ${index + 1} has the wrong shape`]);
    }

    if (alreadyPresent(card, document)) {
      dropped.push({
        index,
        kind: card.kind,
        summary: summaryOf(card),
        reason: "already in the policy",
      });

      return;
    }

    const refusal = refusalOf(card);

    if (refusal !== null) {
      dropped.push({
        index,
        kind: card.kind,
        summary: summaryOf(card),
        reason: refusal,
      });

      return;
    }

    entries.push(
      card.kind === "forbid"
        ? { ...card, today: todayFor(card, document, repository) }
        : card,
    );
  });

  return { entries, dropped };
}
