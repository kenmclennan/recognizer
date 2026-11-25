import { InvalidRequest } from "../../domain/invalid-request.js";
import { comparePlugins } from "../../domain/plugin-order.js";
import type {
  Manifest,
  ManifestRead,
  PlaceholderDeclaration,
} from "../../domain/plugins/manifest.js";
import type { FindingEntry } from "../../domain/plugins/sentence.js";
import {
  unregisteredMessage,
  unregisteredSensors,
} from "../../domain/plugins/unregistered.js";
import type { DocumentValidators } from "./ports/document-validators.js";
import type { Programs } from "./ports/programs.js";
import { readManifestOf } from "./read-manifest.js";

export interface InstalledMetric {
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

export interface InstalledSensorEntry {
  name: string;
  display: string;
  description?: string;
  expansion?: string;
  settings_title?: string;
  runs_tests: boolean;
  suite_keys?: { section: unknown; keys: unknown[] };
  placeholders: Record<string, PlaceholderDeclaration>;
  scoped: boolean;
  planned_work?: { verb: string };
  log_path?: string;
  listed: boolean;
  metrics: InstalledMetric[];
  findings: FindingEntry[];
  settings: unknown[];
}

export interface UnreadableSensor {
  name: string;
  reason: string;
}

export interface InstalledRead {
  sensors: InstalledSensorEntry[];
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

export function sensorNameOf(command: readonly string[]): string | undefined {
  const program = command[0];

  if (program === undefined || !program.startsWith(SENSE_PREFIX)) {
    return undefined;
  }

  return program.slice(SENSE_PREFIX.length);
}

export function isReferenceDescriber(command: readonly string[]): boolean {
  return (command[0] ?? "").startsWith(DESCRIBE_PREFIX);
}

export function noneRegistered(): string {
  return `no describer is registered: install a describer plugin (a program named ${DESCRIBE_PREFIX}<name>) and register it with \`recognizer plugin add <name>\`, or set describer.command in .recognizer/config.yaml`;
}

export function refuseUnregistered(
  registered: readonly string[],
  requested: readonly string[],
  installed: readonly string[],
): void {
  const names = unregisteredSensors(registered, requested, installed);

  if (names.length > 0) {
    throw new InvalidRequest(names.map(unregisteredMessage));
  }
}

function entryOf(manifest: Manifest): InstalledSensorEntry {
  const metrics = (manifest.metrics ?? []) as InstalledMetric[];

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
    placeholders: manifest.placeholders ?? {},
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

export function installedSensorNames(ports: { programs: Programs }): string[] {
  const names = new Set<string>();

  for (const entry of ports.programs.listOnPath([SENSE_PREFIX])) {
    if (
      entry.name.startsWith(SENSE_PREFIX) &&
      entry.name.length > SENSE_PREFIX.length
    ) {
      names.add(entry.name.slice(SENSE_PREFIX.length));
    }
  }

  return [...names].sort();
}

export function readInstalledSensors(
  ports: { programs: Programs; validators: DocumentValidators },
  read: ManifestReader = (prefix) => readManifestOf(ports, prefix),
  names: readonly string[] = installedSensorNames(ports),
): InstalledRead {
  const result: InstalledRead = { sensors: [], unreadable: [] };
  const present = installedSensorNames(ports);

  for (const name of present.filter((one) => names.includes(one))) {
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

  result.sensors.sort(comparePlugins);

  return result;
}

function entryFor(
  command: readonly string[],
  installed: InstalledRead,
): InstalledSensorEntry | undefined {
  const program = command[0];

  if (program === undefined || !program.startsWith(SENSE_PREFIX)) {
    return undefined;
  }

  const name = program.slice(SENSE_PREFIX.length);

  return installed.sensors.find((entry) => entry.name === name);
}

export function runsTests(
  command: readonly string[],
  installed: InstalledRead,
): boolean {
  return entryFor(command, installed)?.runs_tests === true;
}

export function isScoped(
  command: readonly string[],
  installed: InstalledRead,
): boolean {
  return entryFor(command, installed)?.scoped === true;
}

export function receivesSuites(
  name: string,
  installed: InstalledRead,
): boolean {
  return installed.sensors.some(
    (entry) => entry.runs_tests && entry.name === name,
  );
}

export function withSuiteSettings(
  command: string[],
  installed: InstalledRead,
  suites: readonly unknown[] | undefined,
): string[] {
  const name = entryFor(command, installed)?.name;

  if (
    suites === undefined ||
    name === undefined ||
    !receivesSuites(name, installed)
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

export function sensorCommand(
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
): Record<string, unknown> | undefined {
  if (entries === undefined) {
    return entries;
  }

  return Object.fromEntries(
    Object.entries(entries).map(([name, entry]) =>
      name !== "structure" && isSettingsMapping(entry)
        ? [name, { command: sensorCommand(name, entry) }]
        : [name, entry],
    ),
  );
}
