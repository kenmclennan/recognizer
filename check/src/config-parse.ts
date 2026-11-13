import { parse } from "yaml";
import {
  retiredKeysIn,
  withoutRetiredKeysAndEmptiedSections,
} from "./config-retired.js";
import { InputError } from "./errors.js";
import validate from "./generated/config-validator.js";
import { expandShortForms, SHIPPED_SENSORS } from "./shipped-sensors.js";

export interface SensorRegistration {
  command: string[];
}

export interface DuplicationInput {
  threshold?: number;
  min_lines?: number;
  pair_min_lines?: number;
  min_nodes?: number;
}

export interface StructureSettingsInput {
  duplication?: false | DuplicationInput;
  warnings?: {
    cycle?: boolean;
    unused_exports?: boolean;
    private_imports?: boolean;
    long_function?: boolean | { limit: number };
    orphan?: boolean | { entry_points: string[] };
  };
}

export type SensorEntry = SensorRegistration | StructureSettingsInput | "off";

export interface TestSuite {
  name: string;
  language: "python" | "typescript" | "kotlin" | "rust" | "csharp";
  directory: string;
  command: string;
  activate?: string;
  env?: Record<string, string>;
  coverage: { path: string; format: "lcov" | "jacoco" };
  runner?: "vitest" | "jest";
}

export interface Config {
  describer?: { command: string[]; version: string };
  sensors?: Record<string, SensorEntry>;
  tests?: TestSuite[];
}

export function registeredSensors(
  config: Config | null,
): { name: string; command: string[] }[] {
  return Object.entries(config?.sensors ?? {}).flatMap(([name, entry]) =>
    name !== "structure" && typeof entry === "object" && "command" in entry
      ? [{ name, command: entry.command }]
      : [],
  );
}

export function shippedSensorSettings(
  config: Config | null,
  name: string,
): Record<string, unknown> | null {
  const registered = registeredSensors(config).find(
    (sensor) => sensor.name === name,
  );
  const command = registered?.command;

  if (command === undefined || command[0] !== "recognizer-sensors") {
    return null;
  }

  const at = command.indexOf("--settings");
  const text = at === -1 ? undefined : command[at + 1];

  if (text === undefined) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);

    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expandConfig(document: unknown): unknown {
  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document)
  ) {
    return document;
  }

  const record = document as Record<string, unknown>;
  const sensors = expandShortForms(
    record.sensors as Record<string, unknown> | undefined,
    SHIPPED_SENSORS,
    record.tests as TestSuite[] | undefined,
  );

  return {
    ...record,
    ...(sensors === undefined ? {} : { sensors }),
  };
}

function rejectRetiredOverlays(document: unknown): void {
  const retired = retiredKeysIn(document).find(
    ({ path }) => path[0] === "overlays",
  );

  if (retired !== undefined) {
    throw new InputError([retired.message]);
  }
}

export interface EmptySection {
  path: string[];
  message: string;
}

export function emptySections(document: unknown): EmptySection[] {
  if (!isPlainObject(document)) {
    return [];
  }

  const found: EmptySection[] = [];

  for (const [name, value] of Object.entries(document)) {
    if (value === null) {
      found.push({
        path: [name],
        message: `config ${name} is empty: delete the section or give it settings`,
      });
    }
  }

  if (!isPlainObject(document.sensors)) {
    return found;
  }

  for (const [name, value] of Object.entries(document.sensors)) {
    if (value === null) {
      found.push({
        path: ["sensors", name],
        message: `config sensors.${name} is empty: delete the section or give it settings`,
      });
    }
  }

  const structure = document.sensors.structure;

  if (isPlainObject(structure) && structure.warnings === null) {
    found.push({
      path: ["sensors", "structure", "warnings"],
      message:
        "config sensors.structure.warnings is empty: delete the section or give it settings",
    });
  }

  return found;
}

function rejectEmptySections(document: unknown): void {
  const [first] = emptySections(document);

  if (first !== undefined) {
    throw new InputError([first.message]);
  }
}

function rejectRetiredDuplicationSensor(document: unknown): void {
  if (
    isPlainObject(document) &&
    isPlainObject(document.sensors) &&
    "duplication" in document.sensors
  ) {
    throw new InputError([
      "config/sensors/duplication was removed: duplication is now part of the structure sensor and runs with every scan; move its settings to sensors.structure.duplication (threshold, min_lines, pair_min_lines, min_nodes), or set sensors.structure.duplication to false to switch it off, and delete the sensors.duplication key",
    ]);
  }
}

const DUPLICATION_KEYS = [
  "threshold",
  "min_lines",
  "pair_min_lines",
  "min_nodes",
];

function withMovedDuplicationSensor(document: unknown): unknown {
  if (
    !isPlainObject(document) ||
    !isPlainObject(document.sensors) ||
    !("duplication" in document.sensors)
  ) {
    return document;
  }

  const copy = structuredClone(document) as Record<string, unknown>;
  const sensors = copy.sensors as Record<string, unknown>;
  const moved = sensors.duplication;

  delete sensors.duplication;

  if (moved === false) {
    sensors.structure = isPlainObject(sensors.structure)
      ? { duplication: false, ...sensors.structure }
      : sensors.structure === undefined
        ? { duplication: false }
        : sensors.structure;
  } else if (isPlainObject(moved)) {
    const unknown = Object.keys(moved)
      .filter((key) => !DUPLICATION_KEYS.includes(key))
      .sort();

    if (unknown.length > 0) {
      throw new InputError([
        `config/sensors/duplication unknown setting: ${unknown.join(", ")}`,
      ]);
    }

    const present = DUPLICATION_KEYS.filter((key) => key in moved);
    const structure = sensors.structure;

    if (present.length > 0 && structure === undefined) {
      sensors.structure = {
        duplication: Object.fromEntries(
          present.map((key) => [key, moved[key]]),
        ),
      };
    } else if (
      present.length > 0 &&
      isPlainObject(structure) &&
      !("duplication" in structure)
    ) {
      structure.duplication = Object.fromEntries(
        present.map((key) => [key, moved[key]]),
      );
    }
  } else if (moved !== null) {
    throw new InputError([
      "config/sensors/duplication must be a section or false",
    ]);
  }

  if (Object.keys(sensors).length === 0) {
    delete copy.sensors;
  }

  return copy;
}

function rejectBadDuplication(document: unknown): void {
  if (!isPlainObject(document) || !isPlainObject(document.sensors)) {
    return;
  }

  const structure = document.sensors.structure;
  const duplication = isPlainObject(structure)
    ? structure.duplication
    : undefined;

  if (!isPlainObject(duplication)) {
    return;
  }

  const prefix = "config/sensors/structure/duplication";
  const unknown = Object.keys(duplication)
    .filter((key) => !DUPLICATION_KEYS.includes(key))
    .sort();

  if (unknown.length > 0) {
    throw new InputError([`${prefix} unknown setting: ${unknown.join(", ")}`]);
  }

  const threshold = duplication.threshold;

  if (threshold !== undefined) {
    if (typeof threshold !== "number") {
      throw new InputError([`${prefix}/threshold must be a number`]);
    }

    if (!(threshold > 0 && threshold <= 1)) {
      throw new InputError([
        `${prefix}/threshold must be above 0 and at most 1`,
      ]);
    }
  }

  for (const key of DUPLICATION_KEYS.slice(1)) {
    const value = duplication[key];

    if (
      value !== undefined &&
      !(typeof value === "number" && Number.isInteger(value) && value >= 1)
    ) {
      throw new InputError([
        `${prefix}/${key} must be an integer of at least 1`,
      ]);
    }
  }
}

function rejectRetiredWarnings(document: unknown): void {
  const retired = retiredKeysIn(document).find(
    ({ path }) => path[0] !== "overlays",
  );

  if (retired !== undefined) {
    throw new InputError([retired.message]);
  }
}

export interface DuplicateSuite {
  name: string;
  message: string;
}

export function duplicateSuites(document: unknown): DuplicateSuite[] {
  if (!isPlainObject(document) || !Array.isArray(document.tests)) {
    return [];
  }

  const seen = new Set<string>();
  const found: DuplicateSuite[] = [];

  for (const suite of document.tests as { name?: unknown }[]) {
    const name = typeof suite?.name === "string" ? suite.name : "";

    if (name !== "" && seen.has(name)) {
      found.push({
        name,
        message: `config/tests the test suite name ${name} is used twice`,
      });
    }

    seen.add(name);
  }

  return found;
}

function rejectDuplicateSuites(document: unknown): void {
  const [first] = duplicateSuites(document);

  if (first !== undefined) {
    throw new InputError([first.message]);
  }
}

export function schemaMessages(document: unknown): string[] {
  if (validate(document)) {
    return [];
  }

  return (validate.errors ?? []).map((error) => {
    const extra =
      error.keyword === "additionalProperties"
        ? ` (${String(error.params.additionalProperty)})`
        : "";

    return `config${error.instancePath} ${error.message ?? "is invalid"}${extra}`;
  });
}

export function withoutEmptySections(document: unknown): unknown {
  if (!isPlainObject(document)) {
    return document;
  }

  const copy = structuredClone(document) as Record<string, unknown>;

  for (const { path } of emptySections(copy)) {
    let at: unknown = copy;

    for (const step of path.slice(0, -1)) {
      at = (at as Record<string, unknown>)[step];
    }

    delete (at as Record<string, unknown>)[path[path.length - 1] as string];
  }

  return copy;
}

export function expandedConfig(document: unknown): Config {
  return expandConfig(document) as Config;
}

export type ConfigSection = "describer" | "sensors" | "tests";
export type ConfigRead = "all" | readonly ConfigSection[];

export function readsAnyConfig(read: ConfigRead): boolean {
  return read === "all" || read.length > 0;
}

export function readsSensors(read: ConfigRead): boolean {
  return read === "all" || read.includes("sensors");
}

function project(document: unknown, read: ConfigRead): unknown {
  if (read === "all" || !isPlainObject(document)) {
    return document;
  }

  const keep = new Set<string>(read);

  if (keep.has("sensors")) {
    keep.add("tests");
  }

  return Object.fromEntries(
    Object.entries(document).filter(([key]) => keep.has(key)),
  );
}

export interface ConfigOptions {
  skipRetired?: boolean;
}

export function parseConfig(
  text: string,
  read: ConfigRead = "all",
  options: ConfigOptions = {},
): Config {
  if (!readsAnyConfig(read)) {
    return {};
  }

  let document: unknown;

  try {
    document = parse(text) ?? {};
  } catch (error) {
    throw new InputError([
      `config is not valid YAML: ${(error as Error).message}`,
    ]);
  }

  document = project(document, read);

  if (options.skipRetired === true) {
    document = withMovedDuplicationSensor(
      withoutRetiredKeysAndEmptiedSections(document),
    );
  }

  rejectRetiredOverlays(document);
  rejectRetiredDuplicationSensor(document);
  rejectBadDuplication(document);
  rejectEmptySections(document);
  rejectRetiredWarnings(document);

  if (validate(document)) {
    rejectDuplicateSuites(document);

    return expandConfig(document) as Config;
  }

  const messages = schemaMessages(document);

  throw new InputError(messages.length > 0 ? messages : ["config is invalid"]);
}
