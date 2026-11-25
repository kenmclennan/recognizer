import { InvalidRequest } from "../invalid-request.js";

export const REGISTRATION_KEY = "sensors.<name>.command";

export const MANIFEST_KEY = "sensors.<name>.manifest";

export type KeyType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "enum"
  | "path";

export interface KeyEntry {
  key: string;
  type: KeyType;
  values?: string[];
  multi?: boolean;
  default?: string | number | boolean;
  defaults?: Record<string, string | number | boolean>;
  default_text?: string;
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
  exclusiveMaximum?: number;
  off?: boolean;
  description: string;
  example: string;
}

export interface SectionEntry {
  key: string;
  shape: "map-entry" | "list-entry";
  identity?: string;
  description: string;
  example: string;
}

export interface KeySchema {
  keys_version: 1;
  owner: string;
  placeholders: Record<string, string>;
  sections: SectionEntry[];
  keys: KeyEntry[];
}

export type Segment =
  | { literal: string }
  | { placeholder: string; pattern: RegExp };

export interface PublishedKey extends KeyEntry {
  owner: string;
  segments: Segment[];
}

export interface PublishedSection extends SectionEntry {
  owner: string;
  segments: Segment[];
}

export interface PublishedKeys {
  keys: PublishedKey[];
  sections: PublishedSection[];
  notAnswering: string | null;
  subject: "config" | "policy";
}

const SENSOR_NAME = "^[a-z0-9][a-z0-9_-]{0,63}$";

const PROGRAM_NAME = "^recognizer-(scan|sense|describe)-[a-z0-9][a-z0-9_-]*$";

const WARNINGS = [
  "cycle",
  "unused_exports",
  "orphan",
  "private_imports",
  "long_function",
  "complexity",
];

export const CORE_KEYS: KeySchema = {
  keys_version: 1,
  owner: "recognizer",
  placeholders: {
    name: SENSOR_NAME,
    language: SENSOR_NAME,
    program: PROGRAM_NAME,
    warning: `^(${WARNINGS.join("|")})$`,
  },
  sections: [
    {
      key: "sensors.<name>",
      shape: "map-entry",
      description:
        "a registered sensor; writing any key under it registers it too, and an empty one takes the sensor's defaults",
      example: "--add-section sensors.mine",
    },
  ],
  keys: [
    {
      key: "scanners.<language>",
      type: "string",
      description:
        "the scanner that reads a language when two installed scanners claim it, by its manifest name",
      example: "scanners.mylang mylang-alt",
    },
    {
      key: "install.<program>",
      type: "string",
      description:
        "the line that installs a plugin program, recorded by recognizer plugin add and shown by recognizer doctor when the program is missing",
      example: "install.recognizer-sense-mine 'see https://example.com/mine'",
    },
    {
      key: "describer.command",
      type: "string",
      multi: true,
      description:
        "the words of the command that describes a file; {repository}, {module}, {model} and {request} are filled in",
      example: '--add describer.command "recognizer-describe-mine"',
    },
    {
      key: "describer.version",
      type: "string",
      description:
        "the version naming the describer's prompt, recorded bare without the model",
      example: "describer.version 1",
    },
    {
      key: "describer.build.command",
      type: "string",
      multi: true,
      description:
        "the words of the command that builds the describer, run from describer.build.directory when the describer is not built",
      example: '--add describer.build.command "npm"',
    },
    {
      key: "describer.build.directory",
      type: "path",
      description:
        "the folder in the repository the describer's build command runs in",
      example: "describer.build.directory tools/describer",
    },
    {
      key: REGISTRATION_KEY,
      type: "string",
      multi: true,
      description:
        "the words of the command a registered sensor runs; {repository}, {commit} and {output} are filled in",
      example: "--add sensors.mine.command mine",
    },
    {
      key: MANIFEST_KEY,
      type: "string",
      multi: true,
      description:
        "the words of the command that prints a registered sensor's manifest; {repository} is filled in",
      example: "--add sensors.mine.manifest mine",
    },
    {
      key: "sensors.structure",
      type: "enum",
      values: ["off"],
      description: "turns structural analysis off",
      example: "sensors.structure off",
    },
    {
      key: "sensors.structure.duplication",
      type: "boolean",
      description:
        "false switches the duplication check of structural analysis off; it runs with every scan by default",
      example: "sensors.structure.duplication false",
    },
    {
      key: "sensors.structure.duplication.threshold",
      type: "number",
      description:
        "the similarity two functions need to count as duplicates, above 0 and at most 1; default 0.82",
      example: "sensors.structure.duplication.threshold 0.9",
      exclusiveMinimum: 0,
      maximum: 1,
      default: 0.82,
    },
    {
      key: "sensors.structure.duplication.min_lines",
      type: "integer",
      description:
        "the fewest lines a function needs to be compared; default 4",
      example: "sensors.structure.duplication.min_lines 6",
      minimum: 1,
      default: 4,
    },
    {
      key: "sensors.structure.duplication.pair_min_lines",
      type: "integer",
      description:
        "the fewest lines the shorter function of a pair needs; default 6",
      example: "sensors.structure.duplication.pair_min_lines 8",
      minimum: 1,
      default: 6,
    },
    {
      key: "sensors.structure.duplication.min_nodes",
      type: "integer",
      description:
        "the fewest syntax nodes a function needs to be compared; default 20",
      example: "sensors.structure.duplication.min_nodes 30",
      minimum: 1,
      default: 20,
    },
    {
      key: "sensors.structure.warnings.<warning>",
      type: "boolean",
      description: `a switch for one structure warning: ${WARNINGS.join(", ")}`,
      example: "sensors.structure.warnings.unused_exports true",
      defaults: {
        cycle: true,
        orphan: true,
        unused_exports: false,
        private_imports: true,
        long_function: true,
        complexity: true,
      },
    },
    {
      key: "sensors.structure.warnings.long_function.limit",
      type: "integer",
      description:
        "the most lines a function's body may have, not counting its signature, before the long_function warning reports it; default 20 (Clean Code)",
      example: "sensors.structure.warnings.long_function.limit 30",
      minimum: 1,
      default: 20,
    },
    {
      key: "sensors.structure.warnings.complexity.limit",
      type: "integer",
      description:
        "the most branch paths a function may have, as cyclomatic complexity, before the complexity warning reports it; default 10 (McCabe)",
      example: "sensors.structure.warnings.complexity.limit 15",
      minimum: 1,
      default: 10,
    },
    {
      key: "sensors.structure.warnings.orphan.entry_points",
      type: "string",
      multi: true,
      description:
        "globs of the files the orphan and unused_exports warnings treat as entry points",
      example:
        "--add sensors.structure.warnings.orphan.entry_points src/main.ts",
    },
    {
      key: "sensors.structure.warnings.orphan.entry_annotations",
      type: "string",
      multi: true,
      description:
        "simple names of annotations that make a file an entry point for the orphan and unused_exports warnings, beside the shipped container annotations",
      example:
        "--add sensors.structure.warnings.orphan.entry_annotations UseCase",
    },
  ],
};

function compile(
  owner: string,
  placeholders: Record<string, string>,
  key: string,
): Segment[] {
  return key.split(".").map((part): Segment => {
    const match = /^<([a-z][a-z0-9_]*)>$/.exec(part);

    if (match === null) {
      return { literal: part };
    }

    const name = match[1] as string;
    const pattern = placeholders[name];

    if (pattern === undefined) {
      throw new Error(
        `${owner}: key ${key} uses the placeholder <${name}> that it does not define`,
      );
    }

    return { placeholder: name, pattern: new RegExp(pattern) };
  });
}

function literals(segments: Segment[]): number {
  return segments.filter((segment) => "literal" in segment).length;
}

function overlaps(a: Segment, b: Segment): boolean {
  if ("literal" in a && "literal" in b) {
    return a.literal === b.literal;
  }

  if ("literal" in a && "placeholder" in b) {
    return b.pattern.test(a.literal) && !a.literal.includes(".");
  }

  if ("placeholder" in a && "literal" in b) {
    return a.pattern.test(b.literal) && !b.literal.includes(".");
  }

  return true;
}

function collide(a: PublishedKey, b: PublishedKey): boolean {
  return (
    a.segments.length === b.segments.length &&
    literals(a.segments) === literals(b.segments) &&
    a.segments.every((segment, at) =>
      overlaps(segment, b.segments[at] as Segment),
    )
  );
}

export function publish(
  schemas: KeySchema[],
  subject: "config" | "policy",
): PublishedKeys {
  const keys: PublishedKey[] = [];
  const sections: PublishedSection[] = [];

  for (const schema of schemas) {
    for (const key of schema.keys) {
      keys.push({
        ...key,
        owner: schema.owner,
        segments: compile(schema.owner, schema.placeholders, key.key),
      });
    }

    for (const section of schema.sections) {
      sections.push({
        ...section,
        owner: schema.owner,
        segments: compile(schema.owner, schema.placeholders, section.key),
      });
    }
  }

  for (const [at, a] of keys.entries()) {
    for (const b of keys.slice(at + 1)) {
      if (collide(a, b)) {
        throw new Error(
          `the key schemas publish keys that match the same typed key: ${a.key} (${a.owner}) and ${b.key} (${b.owner})`,
        );
      }
    }
  }

  return { keys, sections, notAnswering: null, subject };
}

export function notAnsweringLine(program: string, reason: string): string {
  return `${program} did not answer: ${reason}`;
}

export interface Resolved {
  key: PublishedKey;
}

export type Lookup<T> = { found: T } | { reason: string };

function matchSegments(
  segments: Segment[],
  typed: string[],
): { matched: true } | { matched: false; miss: string | null } {
  if (segments.length !== typed.length) {
    return { matched: false, miss: null };
  }

  let miss: string | null = null;

  for (const [at, segment] of segments.entries()) {
    const part = typed[at] as string;

    if ("literal" in segment) {
      if (segment.literal !== part) {
        return { matched: false, miss: null };
      }
    } else if (!segment.pattern.test(part)) {
      miss ??= `${part} is not a valid <${segment.placeholder}>: it must match ${segment.pattern.source}`;
    }
  }

  return miss === null ? { matched: true } : { matched: false, miss };
}

function best<T extends { segments: Segment[]; owner: string; key: string }>(
  candidates: T[],
  typed: string[],
): Lookup<T> {
  const hits = candidates.filter(
    (candidate) => matchSegments(candidate.segments, typed).matched,
  );

  if (hits.length === 0) {
    const misses = candidates.flatMap((candidate) => {
      const outcome = matchSegments(candidate.segments, typed);

      return !outcome.matched && outcome.miss !== null ? [outcome.miss] : [];
    });

    return { reason: misses[0] ?? "no such key" };
  }

  const top = Math.max(...hits.map((hit) => literals(hit.segments)));
  const winners = hits.filter((hit) => literals(hit.segments) === top);

  if (winners.length > 1) {
    const [a, b] = winners as [T, T];

    throw new InvalidRequest([
      `the key schemas publish keys that match ${typed.join(".")} equally: ${a.key} (${a.owner}) and ${b.key} (${b.owner})`,
    ]);
  }

  return { found: winners[0] as T };
}

export function findKey(
  published: PublishedKeys,
  typed: string[],
): Lookup<PublishedKey> {
  return best(published.keys, typed);
}

export function findSection(
  published: PublishedKeys,
  typed: string[],
): Lookup<PublishedSection> {
  return best(published.sections, typed);
}

export function sectionAt(
  published: PublishedKeys,
  typed: string[],
): PublishedSection | null {
  const lookup = findSection(published, typed);

  return "found" in lookup ? lookup.found : null;
}

export function describeConstraints(entry: KeyEntry): string {
  const parts: string[] = [];

  if (entry.type === "enum") {
    parts.push(`one of ${(entry.values ?? []).join(", ")}`);
  } else {
    parts.push(entry.type);
  }

  if (entry.minimum !== undefined) {
    parts.push(`at least ${entry.minimum}`);
  }

  if (entry.exclusiveMinimum !== undefined) {
    parts.push(`above ${entry.exclusiveMinimum}`);
  }

  if (entry.maximum !== undefined) {
    parts.push(`at most ${entry.maximum}`);
  }

  if (entry.exclusiveMaximum !== undefined) {
    parts.push(`below ${entry.exclusiveMaximum}`);
  }

  if (entry.off === true) {
    parts.push("or false to switch it off");
  }

  const text = parts.join(", ");
  const constraints = entry.multi === true ? `list of ${text}` : text;

  if (entry.default !== undefined) {
    return `${constraints}, default ${entry.default}`;
  }

  if (entry.defaults !== undefined) {
    const figures = Object.entries(entry.defaults)
      .map(([name, value]) => `${name} ${value}`)
      .join(", ");

    return `${constraints}, default ${figures}`;
  }

  if (entry.default_text !== undefined) {
    return `${constraints}, default: ${entry.default_text}`;
  }

  return constraints;
}

export function compileKeySchema(schema: KeySchema): void {
  for (const entry of [...schema.keys, ...schema.sections]) {
    compile(schema.owner, schema.placeholders, entry.key);
  }
}
