import { parse } from "yaml";
import { InputError } from "./errors.js";
import validate from "./generated/config-validator.js";
import {
  expandMeasurerShortForms,
  expandShortForms,
  SHIPPED_SENSORS,
} from "./shipped-sensors.js";

export interface MetricDeclaration {
  name: string;
  type: "ratio" | "count" | "number" | "boolean";
  granularity: "module" | "member";
  bad: "high" | "low";
}

export interface OverlayRegistration {
  command: string[];
  metrics: MetricDeclaration[];
  runs_tests?: boolean;
}

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
    orphan?: boolean | { entry_points: string[] };
  };
}

export type SensorEntry = SensorRegistration | StructureSettingsInput | "off";

export interface Config {
  describer?: { command: string[]; version: string };
  overlays?: Record<string, OverlayRegistration>;
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

function rejectRepeatedMetrics(config: Config): void {
  const messages: string[] = [];

  for (const [name, registration] of Object.entries(config.overlays ?? {})) {
    const seen = new Set<string>();

    for (const metric of registration.metrics) {
      if (seen.has(metric.name)) {
        messages.push(
          `config/overlays/${name} repeats metric name ${metric.name}`,
        );
      }

      seen.add(metric.name);
    }
  }

  if (messages.length > 0) {
    throw new InputError(messages);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withOrphanEntryPoints(
  sensors: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const entry = sensors?.["unused-exports"];

  if (
    sensors === undefined ||
    !isPlainObject(entry) ||
    "command" in entry ||
    "entry_points" in entry
  ) {
    return sensors;
  }

  const structure = sensors.structure;
  const orphan = isPlainObject(structure)
    ? (structure.warnings as Record<string, unknown> | undefined)?.orphan
    : undefined;

  if (!isPlainObject(orphan) || !Array.isArray(orphan.entry_points)) {
    return sensors;
  }

  return {
    ...sensors,
    "unused-exports": { ...entry, entry_points: [...orphan.entry_points] },
  };
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
    withOrphanEntryPoints(
      record.sensors as Record<string, unknown> | undefined,
    ),
    SHIPPED_SENSORS,
  );
  const overlays = expandMeasurerShortForms(
    record.overlays as Record<string, unknown> | undefined,
  );

  return {
    ...record,
    ...(sensors === undefined ? {} : { sensors }),
    ...(overlays === undefined ? {} : { overlays }),
  };
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

  if (validate(document)) {
    const config = expandConfig(document) as Config;

    rejectRepeatedMetrics(config);

    return config;
  }

  const messages = (validate.errors ?? []).map(
    (error) => `config${error.instancePath} ${error.message ?? "is invalid"}`,
  );

  throw new InputError(messages.length > 0 ? messages : ["config is invalid"]);
}
