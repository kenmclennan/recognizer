import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import validateKeySchema from "./generated/config-keys-validator.js";
import { readShippedSensors } from "./shipped-sensors.js";
import { SUITE_KEYS, SUITE_SECTION } from "./suite-keys.js";

export const REGISTRATION_KEY = "sensors.<name>.command";

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
      example: "--add-section sensors.crap",
    },
  ],
  keys: [
    {
      key: "scanners.<language>",
      type: "string",
      description:
        "the scanner that reads a language when two installed scanners claim it, by its manifest name",
      example: "scanners.python python-alt",
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
        "the words of the command that describes a module; {repository}, {module}, {model} and {request} are filled in",
      example: '--add describer.command "recognizer-describe-claude"',
    },
    {
      key: "describer.version",
      type: "string",
      description:
        "the version naming the describer's prompt, recorded bare without the model",
      example: "describer.version 1",
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
      key: "sensors.structure",
      type: "enum",
      values: ["off"],
      description: "turns the structure sensor off",
      example: "sensors.structure off",
    },
    {
      key: "sensors.structure.duplication",
      type: "boolean",
      description:
        "false switches the duplication check of the structure sensor off; it runs with every scan by default",
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
      },
    },
    {
      key: "sensors.structure.warnings.long_function.limit",
      type: "integer",
      description:
        "the most lines a function may have before the long_function warning reports it; default 20 (Clean Code)",
      example: "sensors.structure.warnings.long_function.limit 30",
      minimum: 1,
      default: 20,
    },
    {
      key: "sensors.structure.warnings.orphan.entry_points",
      type: "string",
      multi: true,
      description:
        "globs of the modules the orphan and unused_exports warnings treat as entry points",
      example:
        "--add sensors.structure.warnings.orphan.entry_points src/main.ts",
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

function describeErrors(): string {
  const errors = validateKeySchema.errors ?? [];

  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

export function parseKeySchema(
  text: string,
): { schema: KeySchema } | { reason: string } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { reason: "it printed invalid JSON" };
  }

  const version = (parsed as { keys_version?: unknown } | null)?.keys_version;

  if (version !== 1) {
    return {
      reason: `its keys_version is ${JSON.stringify(version)}, not the 1 this recognizer reads`,
    };
  }

  if (!validateKeySchema(parsed)) {
    return { reason: `its key schema is invalid: ${describeErrors()}` };
  }

  const schema = parsed as KeySchema;

  try {
    compileAll(schema);
  } catch (error) {
    return { reason: (error as Error).message };
  }

  return { schema };
}

function compileAll(schema: KeySchema): void {
  for (const entry of [...schema.keys, ...schema.sections]) {
    compile(schema.owner, schema.placeholders, entry.key);
  }
}

const SENSORS_OWNER = "sensors";

const DISPLAY_FIELDS = new Set([
  "label",
  "labels",
  "unit",
  "units",
  "order",
  "limit",
]);

const SENSOR_PLACEHOLDERS: Record<string, string> = {
  name: "^.+$",
  variable: "^[A-Za-z_][A-Za-z0-9_]*$",
  metric: "^(?!command$)[A-Za-z0-9_-]+$",
};

export function notAnsweringLine(program: string, reason: string): string {
  return `${program} did not answer: ${reason}`;
}

export interface SensorSchemaRead {
  schema: KeySchema;
  notAnswering: string[];
}

export function loadSensorSchema(io: Io): SensorSchemaRead {
  const shipped = readShippedSensors(io);
  const keys: KeyEntry[] = [...SUITE_KEYS];

  for (const sensor of shipped.sensors) {
    for (const entry of sensor.settings as KeyEntry[]) {
      const published = Object.fromEntries(
        Object.entries(entry).filter(([name]) => !DISPLAY_FIELDS.has(name)),
      ) as unknown as KeyEntry;

      keys.push({
        ...published,
        key: `sensors.${sensor.name}.${entry.key}`,
      });
    }
  }

  return {
    schema: {
      keys_version: 1,
      owner: SENSORS_OWNER,
      placeholders: SENSOR_PLACEHOLDERS,
      sections: [SUITE_SECTION],
      keys,
    },
    notAnswering: shipped.unreadable.map((one) =>
      notAnsweringLine(`recognizer-sense-${one.name}`, one.reason),
    ),
  };
}

export function loadKeys(io: Io, _root: string): PublishedKeys {
  const read = loadSensorSchema(io);
  const published = publish([CORE_KEYS, read.schema], "config");

  return read.notAnswering.length === 0
    ? published
    : { ...published, notAnswering: read.notAnswering.join("; ") };
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

    throw new InputError([
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
