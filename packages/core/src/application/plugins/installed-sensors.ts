import { comparePlugins } from "../../domain/plugin-order.js";
import type {
  Manifest,
  ManifestRead,
  PlaceholderDeclaration,
} from "../../domain/plugins/manifest.js";
import type { RegisteredPlugin } from "../../domain/plugins/registration.js";
import type { FindingEntry } from "../../domain/plugins/sentence.js";
import type { Principle } from "../../domain/principles.js";
import type { DocumentValidators } from "./ports/document-validators.js";
import type { PluginRegistrations } from "./ports/plugin-registrations.js";
import type { Programs } from "./ports/programs.js";
import { readManifestCommand } from "./read-manifest.js";

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
  install?: string;
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
  principles?: Principle[];
}

export interface UnreadableSensor {
  name: string;
  reason: string;
}

export interface InstalledRead {
  sensors: InstalledSensorEntry[];
  unreadable: UnreadableSensor[];
  registered?: Record<string, InstalledSensorEntry>;
  registeredUnreadable?: UnreadableSensor[];
}

export interface RegistryReadPorts {
  registrations: PluginRegistrations;
  programs: Programs;
  validators: DocumentValidators;
}

export type ManifestCommandReader = (command: string[]) => ManifestRead;

export interface RegisteredSensorInput {
  name: string;
  command: string[];
  manifest?: string[];
}

export interface RegisteredRead {
  entries: Record<string, InstalledSensorEntry>;
  unreadable: UnreadableSensor[];
}

export function commandKey(command: readonly string[]): string {
  return command.join("\0");
}

const SENSE_PREFIX = "recognizer-sense-";

const DESCRIBE_PREFIX = "recognizer-describe-";

export function sensorProgram(name: string): string {
  return `${SENSE_PREFIX}${name}`;
}

export function describerProgram(name: string): string {
  return `${DESCRIBE_PREFIX}${name}`;
}

export function noneRegistered(): string {
  return "no describer is registered: install a describer plugin and register it with recognizer plugin register <program|path>";
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
    install: manifest.install,
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
    ...(manifest.principles === undefined
      ? {}
      : { principles: manifest.principles }),
  };
}

function registeredSensors(ports: {
  registrations?: PluginRegistrations;
}): RegisteredPlugin[] {
  return (ports.registrations?.entries().plugins ?? []).filter(
    (entry) => entry.kind === "sensor",
  );
}

export interface SensorInEffect {
  name: string;
  command: string[];
  manifest: string[];
}

export function sensorsInEffect(ports: {
  registrations?: PluginRegistrations;
}): SensorInEffect[] {
  return registeredSensors(ports)
    .filter((entry) => entry.name !== "structure")
    .map((entry) => ({
      name: entry.name,
      command: [...entry.command],
      manifest: [...entry.manifest],
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function installedSensorNames(ports: {
  registrations?: PluginRegistrations;
}): string[] {
  return registeredSensors(ports)
    .map((entry) => entry.name)
    .sort();
}

export function readInstalledSensors(
  ports: {
    programs: Programs;
    validators: DocumentValidators;
    registrations?: PluginRegistrations;
  },
  names: readonly string[] = installedSensorNames(ports),
  readCommand: ManifestCommandReader = (words) =>
    readManifestCommand(ports, words),
): InstalledRead {
  const result: InstalledRead = { sensors: [], unreadable: [] };
  const present = installedSensorNames(ports);
  const registered = registeredSensors(ports);

  for (const name of present.filter((one) => names.includes(one))) {
    const own = registered.find((entry) => entry.name === name);
    const manifest = readCommand((own as RegisteredPlugin).manifest);

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

export function readRegisteredSensors(
  registered: readonly RegisteredSensorInput[],
  read: ManifestCommandReader,
): RegisteredRead {
  const result: RegisteredRead = { entries: {}, unreadable: [] };
  const reads = new Map<string, ManifestRead>();

  for (const sensor of registered) {
    if (sensor.manifest === undefined) {
      continue;
    }

    const key = commandKey(sensor.manifest);
    const known = reads.get(key);
    const manifest = known ?? read(sensor.manifest);

    reads.set(key, manifest);

    if (manifest.ok && manifest.manifest.kind === "sensor") {
      const at = commandKey(sensor.command);

      if (result.entries[at] === undefined) {
        result.entries[at] = entryOf(manifest.manifest);
      }
    } else {
      result.unreadable.push({
        name: sensor.name,
        reason: manifest.ok
          ? `${sensor.manifest.join(" ")} manifest is not a sensor`
          : manifest.reason,
      });
    }
  }

  return result;
}

export function withRegistered(
  installed: InstalledRead,
  read: RegisteredRead,
): InstalledRead {
  return {
    ...installed,
    registered: { ...installed.registered, ...read.entries },
    registeredUnreadable: [
      ...(installed.registeredUnreadable ?? []),
      ...read.unreadable,
    ],
  };
}

function entryFor(
  command: readonly string[],
  installed: InstalledRead,
): InstalledSensorEntry | undefined {
  return installed.registered?.[commandKey(command)];
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

function receivesSuitesEntry(entry: InstalledSensorEntry): boolean {
  return entry.runs_tests;
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
  const entry = entryFor(command, installed);

  if (
    suites === undefined ||
    entry === undefined ||
    !receivesSuitesEntry(entry)
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
  program: readonly string[],
  settings: Record<string, unknown>,
): string[] {
  return [
    ...program,
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

function expandedEntry(
  name: string,
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const { manifest, ...settings } = entry;

  return {
    command: sensorCommand([`${SENSE_PREFIX}${name}`], settings),
    ...(manifest === undefined ? {} : { manifest }),
  };
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
        ? [name, expandedEntry(name, entry)]
        : [name, entry],
    ),
  );
}
