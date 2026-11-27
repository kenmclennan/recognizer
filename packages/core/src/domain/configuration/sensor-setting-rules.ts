import { DEFAULT_DUPLICATION_SETTINGS } from "../duplication-settings.js";

export interface SettingFault {
  path: string[];
  message: string;
}

const DUPLICATION_KEYS: string[] = Object.keys(DEFAULT_DUPLICATION_SETTINGS);

const DUPLICATION_PREFIX = "config/sensors/structure/duplication";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(copyOf);
  }

  return isPlainObject(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [key, copyOf(inner)]),
      )
    : value;
}

function sensorsOf(document: unknown): Record<string, unknown> | null {
  return isPlainObject(document) && isPlainObject(document.sensors)
    ? document.sensors
    : null;
}

function structureDuplicationOf(
  document: unknown,
): Record<string, unknown> | null {
  const structure = sensorsOf(document)?.structure;
  const duplication = isPlainObject(structure)
    ? structure.duplication
    : undefined;

  return isPlainObject(duplication) ? duplication : null;
}

export function retiredSensorsIn(document: unknown): SettingFault[] {
  const sensors = sensorsOf(document);
  const faults: SettingFault[] = [];

  if (sensors === null) {
    return faults;
  }

  if ("duplication" in sensors) {
    faults.push({
      path: ["sensors", "duplication"],
      message:
        "config/sensors/duplication was removed: duplication is now part of structural analysis and runs with every scan; move its settings to sensors.structure.duplication (threshold, min_lines, pair_min_lines, min_nodes), or set sensors.structure.duplication to false to switch it off, and delete the sensors.duplication key",
    });
  }

  const entry = sensors["unused-exports"];

  if (isPlainObject(entry) && !("command" in entry)) {
    faults.push({
      path: ["sensors", "unused-exports"],
      message:
        "config/sensors/unused-exports was removed: it is now the structure warning unused_exports; add unused_exports: true under sensors.structure.warnings, move any entry_points it listed under warnings.orphan.entry_points, and delete the sensors.unused-exports key",
    });
  }

  return faults;
}

export function duplicationFaultsIn(document: unknown): SettingFault[] {
  const duplication = structureDuplicationOf(document);

  if (duplication === null) {
    return [];
  }

  const path = ["sensors", "structure", "duplication"];
  const faults: SettingFault[] = [];
  const unknown = Object.keys(duplication)
    .filter((key) => !DUPLICATION_KEYS.includes(key))
    .sort();

  if (unknown.length > 0) {
    faults.push({
      path,
      message: `${DUPLICATION_PREFIX} unknown setting: ${unknown.join(", ")}`,
    });
  }

  const threshold = duplication.threshold;

  if (threshold !== undefined) {
    if (typeof threshold !== "number") {
      faults.push({
        path,
        message: `${DUPLICATION_PREFIX}/threshold must be a number`,
      });
    } else if (!(threshold > 0 && threshold <= 1)) {
      faults.push({
        path,
        message: `${DUPLICATION_PREFIX}/threshold must be above 0 and at most 1`,
      });
    }
  }

  for (const key of DUPLICATION_KEYS.slice(1)) {
    const value = duplication[key];

    if (
      value !== undefined &&
      !(typeof value === "number" && Number.isInteger(value) && value >= 1)
    ) {
      faults.push({
        path,
        message: `${DUPLICATION_PREFIX}/${key} must be an integer of at least 1`,
      });
    }
  }

  return faults;
}

export function withoutFaultySensorSettings(document: unknown): unknown {
  if (!isPlainObject(document) || !isPlainObject(document.sensors)) {
    return document;
  }

  const retired = retiredSensorsIn(document);
  const faulty = duplicationFaultsIn(document).length > 0;

  if (retired.length === 0 && !faulty) {
    return document;
  }

  const copy = copyOf(document) as Record<string, unknown>;
  const sensors = copy.sensors as Record<string, unknown>;

  for (const fault of retired) {
    delete sensors[fault.path[1] as string];
  }

  if (faulty && isPlainObject(sensors.structure)) {
    delete sensors.structure.duplication;
  }

  return copy;
}

export function withMovedDuplicationSensor(document: unknown): {
  document: unknown;
  messages: string[];
} {
  const sensorsIn = sensorsOf(document);

  if (sensorsIn === null || !("duplication" in sensorsIn)) {
    return { document, messages: [] };
  }

  const copy = copyOf(document) as Record<string, unknown>;
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
      return {
        document,
        messages: [
          `config/sensors/duplication unknown setting: ${unknown.join(", ")}`,
        ],
      };
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
    return {
      document,
      messages: ["config/sensors/duplication must be a section or false"],
    };
  }

  if (Object.keys(sensors).length === 0) {
    delete copy.sensors;
  }

  return { document: copy, messages: [] };
}
