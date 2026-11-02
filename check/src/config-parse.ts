import { parse } from "yaml";
import { InputError } from "./errors.js";
import validate from "./generated/config-validator.js";
import { expandShortForms, SHIPPED_SENSORS } from "./shipped-sensors.js";

export interface MetricDeclaration {
  name: string;
  type: "ratio" | "count" | "number" | "boolean";
  granularity: "module" | "member";
  bad: "high" | "low";
}

export interface OverlayRegistration {
  command: string[];
  metrics: MetricDeclaration[];
}

export interface SensorRegistration {
  command: string[];
}

export interface StructureSettingsInput {
  hub_threshold?: number;
  warnings?: {
    cycle?: boolean;
    hub?: boolean;
    folder_cycle?: boolean;
    policy_drift?: boolean;
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
  const overlays = expandShortForms(
    record.overlays as Record<string, unknown> | undefined,
    [],
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
