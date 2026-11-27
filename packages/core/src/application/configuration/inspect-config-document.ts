import {
  retiredSettings,
  unpublishedValues,
} from "../../domain/configuration/key-value.js";
import {
  RETIRED_KEYS,
  type RetiredKey,
} from "../../domain/configuration/retired-keys.js";
import type { PublishedValues } from "../../domain/configuration/survey-answer.js";
import {
  type ThresholdsMigration,
  thresholdsMigration,
} from "../../domain/configuration/thresholds-migration.js";

export {
  duplicationFaultsIn,
  retiredSensorsIn,
  type SettingFault,
  withMovedDuplicationSensor,
  withoutFaultySensorSettings,
} from "../../domain/configuration/sensor-setting-rules.js";
export type { PublishedValues, ThresholdsMigration };

export interface EmptySection {
  path: string[];
  message: string;
}

export interface DuplicateSuite {
  name: string;
  message: string;
}

function cloned<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloned(item)) as T;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloned(item)]),
    ) as T;
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function holds(document: unknown, path: string[]): boolean {
  let at: unknown = document;

  for (const step of path) {
    if (!isPlainObject(at) || !(step in at)) {
      return false;
    }

    at = at[step];
  }

  return true;
}

export function retiredKeysIn(document: unknown): RetiredKey[] {
  return RETIRED_KEYS.filter((retired) => holds(document, retired.path));
}

export function withoutRetiredKeys(document: unknown): unknown {
  if (!isPlainObject(document)) {
    return document;
  }

  const copy = cloned(document) as Record<string, unknown>;

  for (const { path } of retiredKeysIn(copy)) {
    let at: unknown = copy;

    for (const step of path.slice(0, -1)) {
      at = (at as Record<string, unknown>)[step];
    }

    delete (at as Record<string, unknown>)[path[path.length - 1] as string];
  }

  return copy;
}

export function emptySections(document: unknown): EmptySection[] {
  if (!isPlainObject(document)) {
    return [];
  }

  const found: EmptySection[] = [];

  for (const [name, value] of Object.entries(document)) {
    if (value === null) {
      found.push({
        path: [name],
        message: `config ${name} is empty: delete the section or give it settings`,
      });
    }
  }

  if (!isPlainObject(document.sensors)) {
    return found;
  }

  for (const [name, value] of Object.entries(document.sensors)) {
    if (value === null) {
      found.push({
        path: ["sensors", name],
        message: `config sensors.${name} is empty: delete the section or give it settings`,
      });
    }
  }

  const structure = document.sensors.structure;

  if (isPlainObject(structure) && structure.warnings === null) {
    found.push({
      path: ["sensors", "structure", "warnings"],
      message:
        "config sensors.structure.warnings is empty: delete the section or give it settings",
    });
  }

  return found;
}

export function withoutEmptySections(document: unknown): unknown {
  if (!isPlainObject(document)) {
    return document;
  }

  const copy = cloned(document) as Record<string, unknown>;

  for (const { path } of emptySections(copy)) {
    let at: unknown = copy;

    for (const step of path.slice(0, -1)) {
      at = (at as Record<string, unknown>)[step];
    }

    delete (at as Record<string, unknown>)[path[path.length - 1] as string];
  }

  return copy;
}

export function duplicateSuites(document: unknown): DuplicateSuite[] {
  if (!isPlainObject(document) || !Array.isArray(document.tests)) {
    return [];
  }

  const seen = new Set<string>();
  const found: DuplicateSuite[] = [];

  for (const suite of document.tests as { name?: unknown }[]) {
    const name = typeof suite?.name === "string" ? suite.name : "";

    if (name !== "" && seen.has(name)) {
      found.push({
        name,
        message: `config/tests the test suite name ${name} is used twice`,
      });
    }

    seen.add(name);
  }

  return found;
}

export function retiredSettingsIn(document: unknown, keys: PublishedValues) {
  return retiredSettings(document, keys);
}

export function unpublishedValuesIn(
  document: unknown,
  keys: PublishedValues,
): string[] {
  return unpublishedValues(document, keys);
}

export function toleratedMigration(
  document: unknown,
  prefix: (command: string) => string,
): ThresholdsMigration | null {
  return thresholdsMigration(document, prefix);
}
