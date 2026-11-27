import {
  type DuplicateSuite,
  duplicateSuites,
  duplicationFaultsIn,
  type EmptySection,
  emptySections,
  expandedConfigOf,
  expandShortForms,
  registeredSensors,
  retiredSensorsIn,
  withMovedDuplicationSensor,
  withoutEmptySections,
} from "@recognizer/core";
import { parse } from "yaml";
import {
  retiredKeysIn,
  withoutRetiredKeysAndEmptiedSections,
  withoutToleratedKeys,
} from "./config-retired.js";
import { InputError } from "./errors.js";
import configSchema from "./generated/config.schema.json" with { type: "json" };
import validate from "./generated/config-validator.js";

export {
  type DuplicateSuite,
  duplicateSuites,
  type EmptySection,
  emptySections,
  registeredSensors,
  withoutEmptySections,
};

export interface SensorRegistration {
  command: string[];
  manifest?: string[];
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
    complexity?: boolean | { limit: number };
    orphan?:
      | boolean
      | { entry_points?: string[]; entry_annotations?: string[] };
  };
}

export type SensorEntry = SensorRegistration | StructureSettingsInput | "off";

export interface TestSuite {
  name: string;
  language: string;
  directory: string;
  command: string;
  activate?: string;
  env?: Record<string, string>;
  coverage: { path: string; format: string };
  runner?: string;
}

export interface Config {
  describer?: {
    command: string[];
    version: string;
    build?: { command: string[]; directory: string };
  };
  scanners?: Record<string, string>;
  install?: Record<string, string>;
  sensors?: Record<string, SensorEntry>;
  tests?: TestSuite[];
}

export function registeredSensorSettings(
  config: Config | null,
  name: string,
): Record<string, unknown> | null {
  const registered = registeredSensors(config).find(
    (sensor) => sensor.name === name,
  );
  const command = registered?.command;

  if (command === undefined || registered?.manifest === undefined) {
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

const SCHEMA_SENSORS: readonly string[] = Object.keys(
  configSchema.properties.sensors.properties,
);

function withShortFormsExpanded(document: unknown): unknown {
  if (!isPlainObject(document) || !isPlainObject(document.sensors)) {
    return document;
  }

  const open = Object.fromEntries(
    Object.entries(document.sensors).filter(
      ([name]) => !SCHEMA_SENSORS.includes(name),
    ),
  );

  return {
    ...document,
    sensors: { ...document.sensors, ...expandShortForms(open) },
  };
}

function rejectRetiredOverlays(document: unknown): void {
  const retired = retiredKeysIn(document).find(
    ({ path, tolerated }) => path[0] === "overlays" && tolerated !== true,
  );

  if (retired !== undefined) {
    throw new InputError([retired.message]);
  }
}

function rejectEmptySections(document: unknown): void {
  const [first] = emptySections(document);

  if (first !== undefined) {
    throw new InputError([first.message]);
  }
}

function rejectRetiredSensors(document: unknown): void {
  const [first] = retiredSensorsIn(document);

  if (first !== undefined) {
    throw new InputError([first.message]);
  }
}

function rejectDuplicationFaults(document: unknown): void {
  const [first] = duplicationFaultsIn(document);

  if (first !== undefined) {
    throw new InputError([first.message]);
  }
}

function rejectRetiredWarnings(document: unknown): void {
  const retired = retiredKeysIn(document).find(
    ({ path, tolerated }) => path[0] !== "overlays" && tolerated !== true,
  );

  if (retired !== undefined) {
    throw new InputError([retired.message]);
  }
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

export function expandedConfig(document: unknown): Config {
  return expandedConfigOf(document) as Config;
}

export function registeredSensorNamesIn(text: string): string[] {
  try {
    const document = parse(text);

    if (!isPlainObject(document) || !isPlainObject(document.sensors)) {
      return [];
    }

    return registeredSensors(expandedConfig({ sensors: document.sensors })).map(
      ({ name }) => name,
    );
  } catch {
    return [];
  }
}

export type ConfigSection =
  | "describer"
  | "install"
  | "scanners"
  | "sensors"
  | "tests";
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
    const moved = withMovedDuplicationSensor(
      withoutRetiredKeysAndEmptiedSections(document),
    );

    if (moved.messages.length > 0) {
      throw new InputError(moved.messages);
    }

    document = moved.document;
  }

  document = withoutToleratedKeys(document);

  rejectRetiredOverlays(document);
  rejectRetiredSensors(document);
  rejectDuplicationFaults(document);
  rejectEmptySections(document);
  rejectRetiredWarnings(document);

  document = withShortFormsExpanded(document);

  if (validate(document)) {
    rejectDuplicateSuites(document);

    return expandedConfig(document);
  }

  const messages = schemaMessages(document);

  throw new InputError(messages.length > 0 ? messages : ["config is invalid"]);
}
