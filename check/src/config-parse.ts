import { parse } from "yaml";
import { InputError } from "./errors.js";
import validate from "./generated/config-validator.js";
import { expandShortForms, SHIPPED_SENSORS } from "./shipped-sensors.js";

export interface SensorRegistration {
  command: string[];
}

export interface StructureSettingsInput {
  hub_threshold?: number;
  instability_gap?: number;
  composition_roots?: string[];
  warnings?: {
    cycle?: boolean;
    hub?: boolean;
    policy_drift?: boolean;
    stable_dependencies?: boolean;
    unused_exports?: boolean;
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
  if (isPlainObject(document) && "overlays" in document) {
    throw new InputError([
      "config/overlays is retired: measurers are gone, a sensor measures for itself; remove the overlays key and register the sensor under sensors",
    ]);
  }
}

function rejectRetiredWarnings(document: unknown): void {
  if (!isPlainObject(document) || !isPlainObject(document.sensors)) {
    return;
  }

  const structure = document.sensors.structure;

  if (!isPlainObject(structure)) {
    return;
  }

  if ("distance_threshold" in structure) {
    throw new InputError([
      "config/sensors/structure/distance_threshold was removed: the stable abstractions warning it tuned is gone, so the setting did nothing; delete the key",
    ]);
  }

  if (!isPlainObject(structure.warnings)) {
    return;
  }

  if ("stable_abstractions" in structure.warnings) {
    throw new InputError([
      "config/sensors/structure/warnings/stable_abstractions was removed: the warning is gone, so the switch did nothing; delete the key",
    ]);
  }

  if ("folder_cycle" in structure.warnings) {
    throw new InputError([
      "config/sensors/structure/warnings/folder_cycle was removed: a folder declares no imports, so the warning had nothing of its own to report on a file; delete the key (file-level cycles are still reported by the cycle warning)",
    ]);
  }
}

function rejectDuplicateSuites(document: unknown): void {
  if (!isPlainObject(document) || !Array.isArray(document.tests)) {
    return;
  }

  const seen = new Set<string>();

  for (const suite of document.tests as { name?: unknown }[]) {
    const name = typeof suite?.name === "string" ? suite.name : "";

    if (name !== "" && seen.has(name)) {
      throw new InputError([
        `config/tests the test suite name ${name} is used twice`,
      ]);
    }

    seen.add(name);
  }
}

export function parseConfig(text: string): Config {
  let document: unknown;

  try {
    document = parse(text) ?? {};
  } catch (error) {
    throw new InputError([
      `config is not valid YAML: ${(error as Error).message}`,
    ]);
  }

  rejectRetiredOverlays(document);
  rejectRetiredWarnings(document);

  if (validate(document)) {
    rejectDuplicateSuites(document);

    return expandConfig(document) as Config;
  }

  const messages = (validate.errors ?? []).map(
    (error) => `config${error.instancePath} ${error.message ?? "is invalid"}`,
  );

  throw new InputError(messages.length > 0 ? messages : ["config is invalid"]);
}
