import { InvalidRequest } from "../../domain/invalid-request.js";
import type { Manifest, ManifestRead } from "../../domain/plugins/manifest.js";
import type { FindingEntry } from "../../domain/plugins/sentence.js";
import {
  unregisteredMessage,
  unregisteredSensors,
} from "../../domain/plugins/unregistered.js";
import type { DocumentValidators } from "./ports/document-validators.js";
import type { Programs } from "./ports/programs.js";
import type { ShippedPlugins } from "./ports/shipped-plugins.js";
import { readManifestOf } from "./read-manifest.js";

export interface ShippedMetric {
  name: string;
  label: string;
  title?: string;
  help: string;
  type: "ratio" | "count" | "number" | "boolean";
  granularity: "module" | "member";
  bad: "high" | "low";
  cell?: number;
  unlisted?: boolean;
  published?: { value: number; source: string };
}

export interface ShippedSensorEntry {
  name: string;
  display: string;
  description?: string;
  expansion?: string;
  settings_title?: string;
  runs_tests: boolean;
  suite_keys?: { section: unknown; keys: unknown[] };
  scoped: boolean;
  planned_work?: { verb: string };
  log_path?: string;
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

const SENSE_PREFIX = "recognizer-sense-";

const DESCRIBE_PREFIX = "recognizer-describe-";

export function sensorProgram(name: string): string {
  return `${SENSE_PREFIX}${name}`;
}

export function describerProgram(name: string): string {
  return `${DESCRIBE_PREFIX}${name}`;
}

export function shippedSensorOf(
  command: readonly string[],
  shipped: readonly string[],
): string | undefined {
  const program = command[0];

  if (program === undefined || !program.startsWith(SENSE_PREFIX)) {
    return undefined;
  }

  const name = program.slice(SENSE_PREFIX.length);

  return shipped.includes(name) ? name : undefined;
}

export function shippedDescriberCommand(name: string): string[] {
  return [
    `${DESCRIBE_PREFIX}${name}`,
    "run",
    "--model",
    "{model}",
    "{request}",
  ];
}

export function refuseUnregistered(
  registered: readonly string[],
  requested: readonly string[],
  shipped: readonly string[],
): void {
  const names = unregisteredSensors(registered, requested, shipped);

  if (names.length > 0) {
    throw new InvalidRequest(names.map(unregisteredMessage));
  }
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
    ...(manifest.suite_keys === undefined
      ? {}
      : { suite_keys: manifest.suite_keys }),
    scoped: manifest.scoped === true,
    ...(manifest.planned_work === undefined
      ? {}
      : { planned_work: manifest.planned_work }),
    ...(manifest.log_path === undefined ? {} : { log_path: manifest.log_path }),
    listed: metrics.length > 0,
    metrics,
    findings: manifest.findings ?? [],
    settings: manifest.settings,
  };
}

export function readShippedSensors(
  ports: {
    programs: Programs;
    validators: DocumentValidators;
    shipped: ShippedPlugins;
  },
  read: ManifestReader = (prefix) => readManifestOf(ports, prefix),
  names: readonly string[] = ports.shipped.sensors(),
): ShippedRead {
  const result: ShippedRead = { sensors: [], unreadable: [] };

  for (const name of ports.shipped
    .sensors()
    .filter((one) => names.includes(one))) {
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
  const program = command[0];

  if (program === undefined || !program.startsWith(SENSE_PREFIX)) {
    return undefined;
  }

  const name = program.slice(SENSE_PREFIX.length);

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
  const name = entryFor(command, shipped)?.name;

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
