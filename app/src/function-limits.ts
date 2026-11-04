import { type Config, parseConfig, shippedSensorSettings } from "recognizer";

export const COMPLEXITY_ABOVE = 10;
export const COVERAGE_BELOW = 0.6;
export const CRAP_AT = 30;

export type FunctionLimits = {
  complexityAbove: number | null;
  coverageBelow: number | null;
  crapAt: number;
};

export const DEFAULT_LIMITS: FunctionLimits = {
  complexityAbove: COMPLEXITY_ABOVE,
  coverageBelow: COVERAGE_BELOW,
  crapAt: CRAP_AT,
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
  fallback: number,
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

export function functionLimits(config: Config | null): FunctionLimits {
  const thresholds = shippedSensorSettings(config, "thresholds");
  const crap = entryOf(shippedSensorSettings(config, "crap"), "threshold");

  return {
    complexityAbove: limitFrom(
      thresholds,
      "complexity",
      "above",
      COMPLEXITY_ABOVE,
    ),
    coverageBelow: limitFrom(thresholds, "coverage", "below", COVERAGE_BELOW),
    crapAt: isNumber(crap) ? crap : CRAP_AT,
  };
}

export function limitsFromText(text: string | null): FunctionLimits {
  if (text === null) {
    return DEFAULT_LIMITS;
  }

  try {
    return functionLimits(parseConfig(text));
  } catch {
    return DEFAULT_LIMITS;
  }
}
