import {
  type Config,
  LONG_FUNCTION,
  parseConfig,
  resolveStructureSettings,
  shippedSensorSettings,
} from "recognizer";

import type { ShippedSensors } from "./sensor-run";

export type FunctionLimits = {
  complexityAbove: number | null;
  coverageBelow: number | null;
  crapAt: number | null;
  longAt: number;
};

export const DEFAULT_LIMITS: FunctionLimits = {
  complexityAbove: null,
  coverageBelow: null,
  crapAt: null,
  longAt: LONG_FUNCTION,
};

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function entryOf(
  settings: Record<string, unknown> | null,
  name: string,
): unknown {
  return settings === null ? undefined : settings[name];
}

function limitFrom(
  settings: Record<string, unknown> | null,
  name: string,
  key: "above" | "below",
  fallback: number | null,
): number | null {
  const entry = entryOf(settings, name);

  if (entry === "off") {
    return null;
  }

  if (typeof entry === "object" && entry !== null && key in entry) {
    const value = (entry as Record<string, unknown>)[key];

    return isNumber(value) ? value : fallback;
  }

  return fallback;
}

function publishedOf(shipped: ShippedSensors | null, metric: string) {
  if (shipped === null || shipped.status !== "ok") {
    return null;
  }

  for (const sensor of shipped.sensors) {
    const value = sensor.metrics.find((one) => one.name === metric)?.published
      ?.value;

    if (isNumber(value)) {
      return value;
    }
  }

  return null;
}

function crapDefault(shipped: ShippedSensors | null): number | null {
  if (shipped === null || shipped.status !== "ok") {
    return null;
  }

  const sensor = shipped.sensors.find((one) => one.name === "crap");
  const value = sensor?.settings.find(
    (one) => one.key === "threshold",
  )?.default;

  return isNumber(value) ? value : null;
}

export function functionLimits(
  config: Config | null,
  shipped: ShippedSensors | null,
): FunctionLimits {
  const thresholds = shippedSensorSettings(config, "thresholds");
  const crap = entryOf(shippedSensorSettings(config, "crap"), "threshold");

  const structure = resolveStructureSettings(config);

  return {
    longAt:
      structure === "off" || !structure.warnings.long_function
        ? LONG_FUNCTION
        : structure.long_function_limit,
    complexityAbove: limitFrom(
      thresholds,
      "complexity",
      "above",
      publishedOf(shipped, "complexity"),
    ),
    coverageBelow: limitFrom(
      thresholds,
      "coverage",
      "below",
      publishedOf(shipped, "coverage"),
    ),
    crapAt: isNumber(crap) ? crap : crapDefault(shipped),
  };
}

export function limitsFromText(
  text: string | null,
  shipped: ShippedSensors | null,
): FunctionLimits {
  if (text === null) {
    return functionLimits(null, shipped);
  }

  try {
    return functionLimits(parseConfig(text), shipped);
  } catch {
    return DEFAULT_LIMITS;
  }
}
