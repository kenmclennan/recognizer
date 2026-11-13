import {
  type Config,
  LONG_FUNCTION,
  parseConfig,
  resolveStructureSettings,
  shippedSensorSettings,
} from "recognizer";

import type {
  ShippedMetric,
  ShippedSensor,
  ShippedSensors,
  ShippedSetting,
} from "./sensor-run";

export type CellLimit = {
  metric: string;
  label: string;
  limit: {
    direction: "above" | "below";
    value: number;
    tone: "amber" | "red";
  } | null;
};

export type FunctionLimits = {
  longAt: number;
  cells: CellLimit[];
};

export const DEFAULT_LIMITS: FunctionLimits = {
  longAt: LONG_FUNCTION,
  cells: [],
};

type Settings = Record<string, unknown> | null;

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const PLACEHOLDER = /<[a-z][a-z0-9_]*>/;

function at(settings: Settings, path: string[]): unknown {
  let node: unknown = settings;

  for (const part of path) {
    if (typeof node !== "object" || node === null || !(part in node)) {
      return undefined;
    }

    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

function defaultOf(setting: ShippedSetting | undefined, metric: string) {
  return setting?.default ?? setting?.defaults?.[metric];
}

function limitsMetric(setting: ShippedSetting, metric: string): boolean {
  const limit = setting.limit;

  if (limit === undefined) {
    return false;
  }

  return PLACEHOLDER.test(limit.metric)
    ? Object.keys(setting.defaults ?? {}).includes(metric)
    : limit.metric === metric;
}

function isOff(
  sensor: ShippedSensor,
  settings: Settings,
  path: string[],
  metric: string,
): boolean {
  const declared = new Set(
    sensor.settings
      .filter((one) => one.type === "enum")
      .map((one) => one.key.replace(PLACEHOLDER, metric)),
  );

  for (let length = 1; length < path.length; length += 1) {
    const prefix = path.slice(0, length);

    if (declared.has(prefix.join(".")) && at(settings, prefix) === "off") {
      return true;
    }
  }

  return false;
}

function cellLimit(
  { name: metric, label }: ShippedMetric,
  config: Config | null,
  sensors: readonly ShippedSensor[],
): CellLimit {
  for (const sensor of sensors) {
    const settings = shippedSensorSettings(config, sensor.name);

    for (const setting of sensor.settings) {
      if (setting.limit === undefined || !limitsMetric(setting, metric)) {
        continue;
      }

      const path = setting.key.replace(PLACEHOLDER, metric).split(".");
      const configured = at(settings, path);
      const fallback = defaultOf(setting, metric);
      const value = isNumber(configured) ? configured : fallback;

      if (isOff(sensor, settings, path, metric) || !isNumber(value)) {
        return { metric, label, limit: null };
      }

      const severityKey = setting.limit.severity;
      const severity =
        severityKey === undefined
          ? undefined
          : (at(
              settings,
              severityKey.replace(PLACEHOLDER, metric).split("."),
            ) ??
            defaultOf(
              sensor.settings.find((one) => one.key === severityKey),
              metric,
            ));

      return {
        metric,
        label,
        limit: {
          direction: setting.limit.direction,
          value,
          tone: severity === "violation" ? "red" : "amber",
        },
      };
    }
  }

  return { metric, label, limit: null };
}

function cellsOf(
  config: Config | null,
  shipped: ShippedSensors | null,
): CellLimit[] {
  if (shipped === null || shipped.status !== "ok") {
    return [];
  }

  return shipped.sensors
    .flatMap((sensor) => sensor.metrics)
    .filter((metric) => metric.cell !== undefined)
    .sort((a, b) => (a.cell as number) - (b.cell as number))
    .map((metric) => cellLimit(metric, config, shipped.sensors));
}

export function functionLimits(
  config: Config | null,
  shipped: ShippedSensors | null,
): FunctionLimits {
  const structure = resolveStructureSettings(config);

  return {
    longAt:
      structure === "off" || !structure.warnings.long_function
        ? LONG_FUNCTION
        : structure.long_function_limit,
    cells: cellsOf(config, shipped),
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
