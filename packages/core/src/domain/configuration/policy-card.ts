export interface IgnoreCard {
  kind: "ignore";
  globs: string[];
  why: string;
  based_on: string;
}

export interface EntryCard {
  kind: "entry";
  paths: string[];
  why: string;
  based_on: string;
}

export interface ForbidCard {
  kind: "forbid";
  from: string[];
  to: string[];
  both: boolean;
  why: string;
  based_on: string;
  today?: { count: number; example: string | null };
}

export type PolicyCard = IgnoreCard | EntryCard | ForbidCard;

export interface DroppedCard {
  index: number;
  kind: string;
  summary: string;
  reason: string;
}

export interface Recommendation {
  entries: PolicyCard[];
  dropped: DroppedCard[];
}

const STRING_LIST = {
  type: "array",
  minItems: 1,
  items: { type: "string", minLength: 1 },
};

export const POLICY_RECOMMENDATION_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        oneOf: [
          {
            type: "object",
            properties: {
              kind: { const: "ignore" },
              globs: STRING_LIST,
              why: { type: "string" },
              based_on: { type: "string" },
            },
            required: ["kind", "globs", "why", "based_on"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: { const: "entry" },
              paths: STRING_LIST,
              why: { type: "string" },
              based_on: { type: "string" },
            },
            required: ["kind", "paths", "why", "based_on"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: { const: "forbid" },
              from: STRING_LIST,
              to: STRING_LIST,
              both: { type: "boolean" },
              why: { type: "string" },
              based_on: { type: "string" },
            },
            required: ["kind", "\u0066rom", "to", "both", "why", "based_on"],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  required: ["entries"],
  additionalProperties: false,
};

function isStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item !== "")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(record: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}

export function parseCard(value: unknown): PolicyCard | null {
  if (!isRecord(value) || typeof value.why !== "string") {
    return null;
  }

  if (typeof value.based_on !== "string") {
    return null;
  }

  const shared = { why: value.why, based_on: value.based_on };

  if (
    value.kind === "ignore" &&
    isStrings(value.globs) &&
    hasOnly(value, ["kind", "globs", "why", "based_on"])
  ) {
    return { kind: "ignore", globs: value.globs, ...shared };
  }

  if (
    value.kind === "entry" &&
    isStrings(value.paths) &&
    hasOnly(value, ["kind", "paths", "why", "based_on"])
  ) {
    return { kind: "entry", paths: value.paths, ...shared };
  }

  if (
    value.kind === "forbid" &&
    isStrings(value.from) &&
    isStrings(value.to) &&
    typeof value.both === "boolean" &&
    hasOnly(value, ["kind", "\u0066rom", "to", "both", "why", "based_on"])
  ) {
    return {
      kind: "forbid",
      from: value.from,
      to: value.to,
      both: value.both,
      ...shared,
    };
  }

  return null;
}

function forbidArgv(from: string[], to: string[]): string[] {
  return [
    "recognizer",
    "policy",
    "--add-forbid",
    ...from.flatMap((glob) => ["--\u0066rom", glob]),
    ...to.flatMap((glob) => ["--to", glob]),
  ];
}

export function policyCommands(card: PolicyCard): string[][] {
  if (card.kind === "ignore") {
    return card.globs.map((glob) => [
      "recognizer",
      "policy",
      "--add",
      "ignore",
      glob,
    ]);
  }

  if (card.kind === "entry") {
    return card.paths.map((path) => [
      "recognizer",
      "policy",
      "--add",
      "entry",
      path,
    ]);
  }

  return card.both
    ? [forbidArgv(card.from, card.to), forbidArgv(card.to, card.from)]
    : [forbidArgv(card.from, card.to)];
}

export function summaryOf(card: PolicyCard): string {
  if (card.kind === "ignore") {
    return `ignore ${card.globs.join(", ")}`;
  }

  if (card.kind === "entry") {
    return `entry ${card.paths.join(", ")}`;
  }

  return `files in ${card.from.join(", ")} must not import ${card.both ? "each other" : `from ${card.to.join(", ")}`}`;
}
