import { expandShortForms } from "./installed-sensors.js";

export interface SensorRegistration {
  name: string;
  command: string[];
  manifest?: string[];
}

export interface ExpandedConfig {
  describer?: { command: string[] };
  sensors?: Record<string, unknown>;
}

export function expandedConfigOf(document: unknown): unknown {
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
  );

  return {
    ...record,
    ...(sensors === undefined ? {} : { sensors }),
  };
}

export function registeredSensors(
  config: { sensors?: Record<string, unknown> } | null,
): SensorRegistration[] {
  return Object.entries(config?.sensors ?? {}).flatMap(([name, entry]) => {
    if (
      name === "structure" ||
      typeof entry !== "object" ||
      entry === null ||
      !("command" in entry)
    ) {
      return [];
    }

    const { command, manifest } = entry as {
      command: string[];
      manifest?: string[];
    };

    return [{ name, command, ...(manifest === undefined ? {} : { manifest }) }];
  });
}
