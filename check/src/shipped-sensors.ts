import type { Io } from "./cli.js";
import {
  type Manifest,
  type ManifestRead,
  readManifestOf,
} from "./plugin-manifest.js";
import type { FindingEntry } from "./plugin-sentence.js";

export interface ShippedMetric {
  name: string;
  label: string;
  title?: string;
  help: string;
  type: "ratio" | "count" | "number" | "boolean";
  granularity: "module" | "member";
  bad: "high" | "low";
  cell?: number;
  published?: { value: number; source: string };
}

export interface ShippedSensorEntry {
  name: string;
  display: string;
  description?: string;
  expansion?: string;
  settings_title?: string;
  runs_tests: boolean;
  scoped: boolean;
  listed: boolean;
  metrics: ShippedMetric[];
  findings: FindingEntry[];
  settings: unknown[];
}

export interface UnreadableSensor {
  name: string;
  reason: string;
}

export interface ShippedRead {
  sensors: ShippedSensorEntry[];
  unreadable: UnreadableSensor[];
}

export type ManifestReader = (prefix: string[]) => ManifestRead;

export const SHIPPED_SENSORS: readonly string[] = [
  "crap",
  "mutation",
  "thresholds",
];

export function shippedSensorNames(): string[] {
  return [...SHIPPED_SENSORS];
}

const SENSE_PREFIX = "recognizer-sense-";

export function shippedSensorOf(
  command: readonly string[],
): string | undefined {
  const program = command[0];

  if (program === undefined || !program.startsWith(SENSE_PREFIX)) {
    return undefined;
  }

  const name = program.slice(SENSE_PREFIX.length);

  return SHIPPED_SENSORS.includes(name) ? name : undefined;
}

function entryOf(manifest: Manifest): ShippedSensorEntry {
  const metrics = (manifest.metrics ?? []) as ShippedMetric[];

  return {
    name: manifest.name,
    display: manifest.display,
    ...(manifest.description === undefined
      ? {}
      : { description: manifest.description }),
    ...(manifest.expansion === undefined
      ? {}
      : { expansion: manifest.expansion }),
    ...(manifest.settings_title === undefined
      ? {}
      : { settings_title: manifest.settings_title }),
    runs_tests: manifest.runs_tests === true,
    scoped: manifest.scoped === true,
    listed: metrics.length > 0,
    metrics,
    findings: manifest.findings ?? [],
    settings: manifest.settings,
  };
}

export function readShippedSensors(
  io: Io,
  read: ManifestReader = (prefix) => readManifestOf(io, prefix),
  names: readonly string[] = SHIPPED_SENSORS,
): ShippedRead {
  const result: ShippedRead = { sensors: [], unreadable: [] };

  for (const name of SHIPPED_SENSORS.filter((one) => names.includes(one))) {
    const manifest = read([`${SENSE_PREFIX}${name}`]);

    if (manifest.ok && manifest.manifest.kind === "sensor") {
      result.sensors.push(entryOf(manifest.manifest));
    } else {
      result.unreadable.push({
        name,
        reason: manifest.ok
          ? `${SENSE_PREFIX}${name} manifest is not a sensor`
          : manifest.reason,
      });
    }
  }

  return result;
}

function entryFor(
  command: readonly string[],
  shipped: ShippedRead,
): ShippedSensorEntry | undefined {
  const name = shippedSensorOf(command);

  return shipped.sensors.find((entry) => entry.name === name);
}

export function runsTests(
  command: readonly string[],
  shipped: ShippedRead,
): boolean {
  return entryFor(command, shipped)?.runs_tests === true;
}

export function isScoped(
  command: readonly string[],
  shipped: ShippedRead,
): boolean {
  return entryFor(command, shipped)?.scoped === true;
}

export function receivesSuites(name: string, shipped: ShippedRead): boolean {
  return shipped.sensors.some(
    (entry) => entry.runs_tests && entry.name === name,
  );
}

export function withSuiteSettings(
  command: string[],
  shipped: ShippedRead,
  suites: readonly unknown[] | undefined,
): string[] {
  const name = shippedSensorOf(command);

  if (
    suites === undefined ||
    name === undefined ||
    !receivesSuites(name, shipped)
  ) {
    return command;
  }

  const at = command.indexOf("--settings");
  const text = at === -1 ? undefined : command[at + 1];

  if (text === undefined) {
    return command;
  }

  try {
    const parsed: unknown = JSON.parse(text);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return command;
    }

    const next = [...command];

    next[at + 1] = JSON.stringify({ ...parsed, tests: suites });

    return next;
  } catch {
    return command;
  }
}

function isSettingsMapping(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !("command" in value)
  );
}

export function shippedCommand(
  name: string,
  settings: Record<string, unknown>,
): string[] {
  return [
    `${SENSE_PREFIX}${name}`,
    "run",
    "--repository",
    "{repository}",
    "--commit",
    "{commit}",
    "--output",
    "{output}",
    "--settings",
    JSON.stringify(settings),
  ];
}

export function expandShortForms(
  entries: Record<string, unknown> | undefined,
  shipped: readonly string[],
): Record<string, unknown> | undefined {
  if (entries === undefined) {
    return entries;
  }

  return Object.fromEntries(
    Object.entries(entries).map(([name, entry]) =>
      shipped.includes(name) && isSettingsMapping(entry)
        ? [name, { command: shippedCommand(name, entry) }]
        : [name, entry],
    ),
  );
}
