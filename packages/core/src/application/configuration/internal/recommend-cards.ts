import {
  type DroppedCard,
  type ForbidCard,
  type PolicyCard,
  parseCard,
  type Recommendation,
  summaryOf,
} from "../../../domain/configuration/policy-card.js";
import { InvalidRequest } from "../../../domain/invalid-request.js";
import type { PolicyRepository } from "../../../domain/policy-repository.js";
import type { Repository } from "../../../domain/repository.js";

type Document = Record<string, unknown>;

function isRecord(value: unknown): value is Document {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function sameList(a: unknown, b: string[]): boolean {
  const items = listOf(a);

  return items.length === b.length && items.every((item, at) => item === b[at]);
}

function forbidPresent(
  document: Document,
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

function alreadyPresent(card: PolicyCard, document: Document): boolean {
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

function refusalOf(policy: PolicyRepository, card: PolicyCard): string | null {
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
    policy.parseDocument(body);

    return null;
  } catch (error) {
    return error instanceof InvalidRequest
      ? error.messages.join("; ")
      : (error as Error).message;
  }
}

function todayFor(
  policy: PolicyRepository,
  card: ForbidCard,
  document: Document,
  repository: Repository,
): { count: number; example: string | null } {
  const directions = [{ from: card.from, to: card.to }];

  if (card.both) {
    directions.push({ from: card.to, to: card.from });
  }

  const rules = policy.parseDocument({
    ...(document.ignore === undefined ? {} : { ignore: document.ignore }),
    forbid: directions,
  });
  let count = 0;
  let example: string | null = null;

  for (const violation of repository.violations(rules)) {
    for (const one of violation.dependencies) {
      count += 1;
      example ??= `${violation.file} -> ${one.to}`;
    }
  }

  return { count, example };
}

export function recommendCards(
  policy: PolicyRepository,
  root: string,
  input: unknown,
  repository: Repository,
): Recommendation {
  if (!isRecord(input) || !Array.isArray(input.entries)) {
    throw new InvalidRequest(["the recommendation has no entries list"]);
  }

  const document = policy.document(root);
  const entries: PolicyCard[] = [];
  const dropped: DroppedCard[] = [];

  input.entries.forEach((raw: unknown, index: number) => {
    const card = parseCard(raw);

    if (card === null) {
      throw new InvalidRequest([`entry ${index + 1} has the wrong shape`]);
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

    const refusal = refusalOf(policy, card);

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
        ? { ...card, today: todayFor(policy, card, document, repository) }
        : card,
    );
  });

  return { entries, dropped };
}
