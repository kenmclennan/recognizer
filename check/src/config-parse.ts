import { parse } from "yaml";
import { InputError } from "./errors.js";
import validate from "./generated/config-validator.js";
import { expandShortForms, SHIPPED_SENSORS } from "./shipped-sensors.js";

export interface SensorRegistration {
  command: string[];
}

export interface StructureSettingsInput {
  hub_threshold?: number;
  distance_threshold?: number;
  warnings?: {
    cycle?: boolean;
    hub?: boolean;
    folder_cycle?: boolean;
    policy_drift?: boolean;
    stable_dependencies?: boolean;
    stable_abstractions?: boolean;
    unused_exports?: boolean;
    orphan?: boolean | { entry_points: string[] };
  };
}

export type SensorEntry = SensorRegistration | StructureSettingsInput | "off";

export interface Config {
  describer?: { command: string[]; version: string };
  sensors?: Record<string, SensorEntry>;
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

  if (validate(document)) {
    return expandConfig(document) as Config;
  }

  const messages = (validate.errors ?? []).map(
    (error) => `config${error.instancePath} ${error.message ?? "is invalid"}`,
  );

  throw new InputError(messages.length > 0 ? messages : ["config is invalid"]);
}
