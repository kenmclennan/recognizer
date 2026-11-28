import {
  commandFix,
  textFix,
  withRepository,
} from "../../domain/plugins/doctor-commands.js";
import type {
  ConfigRegistration,
  Found,
  PluginSpec,
  RegisteredPlugins,
} from "../../domain/plugins/doctor-report.js";
import {
  duplicateSuites,
  duplicationFaultsIn,
  emptySections,
  retiredKeysIn,
  retiredSensorsIn,
  retiredSettingsIn,
  toleratedMigration,
  unpublishedValuesIn,
  withoutEmptySections,
  withoutFaultySensorSettings,
  withoutRetiredKeys,
} from "../configuration/inspect-config-document.js";
import { DESCRIBER_RUN_WORDS } from "../describing/read-describer.js";
import { sensorCommand, sensorsInEffect } from "./installed-sensors.js";
import type { PluginRegistrations } from "./ports/plugin-registrations.js";
import type { RepositoryChecks } from "./ports/repository-checks.js";

export interface ConfigReading {
  problems: Found[];
  registered: ConfigRegistration;
}

const CONFIG_FILE = ".recognizer/config.yaml";
const SKIP_CONFIG = "config has problems";

function schemaSubject(message: string): string {
  const path = /^config(\S*)/.exec(message)?.[1] ?? "";

  return path === "" ? "config" : path.slice(1).replaceAll("/", ".");
}

function hasSuites(document: unknown): boolean {
  const tests = (document as { tests?: unknown } | null)?.tests;

  return Array.isArray(tests) && tests.length > 0;
}

function stringMap(value: unknown): Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};
}

function settingsIn(
  document: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const sensors = document.sensors;
  const entry =
    typeof sensors === "object" && sensors !== null && !Array.isArray(sensors)
      ? (sensors as Record<string, unknown>)[name]
      : undefined;

  if (
    typeof entry !== "object" ||
    entry === null ||
    Array.isArray(entry) ||
    "command" in entry
  ) {
    return {};
  }

  const { manifest: _manifest, ...settings } = entry as Record<string, unknown>;

  return settings;
}

function specsOf(
  registrations: PluginRegistrations,
  document: Record<string, unknown>,
): PluginSpec[] {
  const specs: PluginSpec[] = sensorsInEffect({ registrations }).map(
    (sensor): PluginSpec => {
      const settings = settingsIn(document, sensor.name);

      return {
        kind: "sensor",
        subject: sensor.name,
        name: sensor.name,
        program: sensor.manifest[0] as string,
        command: sensorCommand(sensor.command, settings),
        manifest: sensor.manifest,
        settings,
        installLine: null,
      };
    },
  );
  const describer = registrations.entries().describer;

  if (describer !== null) {
    specs.push({
      kind: "describer",
      subject: "describer",
      name: describer.name,
      program: describer.command[0] as string,
      command: [...describer.command, ...DESCRIBER_RUN_WORDS],
      manifest: describer.manifest,
      settings: null,
      installLine: null,
    });
  }

  return specs;
}

function registeredFrom(
  registrations: PluginRegistrations,
  record: Record<string, unknown>,
): RegisteredPlugins {
  const specs = specsOf(registrations, record);

  return {
    specs,
    named: stringMap(record.scanners),
    install: {},
    sensors: specs
      .filter((one) => one.kind === "sensor")
      .map((one) => one.name),
    describer: specs.some((one) => one.kind === "describer"),
  };
}

export function readConfigArea(
  repository: RepositoryChecks,
  registrations: PluginRegistrations,
  root: string,
  named: boolean,
): ConfigReading {
  const target = { repository: root, named };
  const read = repository.configDocument(root);

  if (read.kind === "absent") {
    return { problems: [], registered: registeredFrom(registrations, {}) };
  }

  if (read.kind === "unparseable") {
    return {
      problems: [
        {
          code: "config-yaml",
          subject: CONFIG_FILE,
          line: `config is not valid YAML: ${read.message}`,
          fix: textFix(`correct the YAML in ${CONFIG_FILE}`),
        },
      ],
      registered: {
        skipped: SKIP_CONFIG,
      },
    };
  }

  const document = read.document;
  const problems: Found[] = [];

  for (const retired of retiredKeysIn(document)) {
    const key = retired.path.join(".");
    const migration = retired.tolerated
      ? toleratedMigration(document, (command) =>
          withRepository(target, command),
        )
      : null;

    if (migration !== null) {
      problems.push({
        code: "config-retired",
        subject: key,
        line: migration.line,
        fix: commandFix(migration.command),
      });

      continue;
    }

    problems.push({
      code: "config-retired",
      subject: key,
      line: retired.message,
      fix: commandFix(
        withRepository(target, `recognizer config --unset ${key}`),
      ),
    });
  }

  for (const retired of retiredSensorsIn(document)) {
    const key = retired.path.join(".");

    problems.push({
      code: "config-retired",
      subject: key,
      line: retired.message,
      fix: textFix(`delete ${key} in ${CONFIG_FILE} after moving its settings`),
    });
  }

  for (const empty of emptySections(document)) {
    const key = empty.path.join(".");
    const removable = empty.path.length === 2 && empty.path[0] === "sensors";

    problems.push({
      code: "config-empty",
      subject: key,
      line: empty.message,
      fix: removable
        ? commandFix(
            withRepository(target, `recognizer config --remove-section ${key}`),
          )
        : textFix(`delete ${key} in ${CONFIG_FILE}, or give it settings`),
    });
  }

  for (const duplicate of duplicateSuites(document)) {
    problems.push({
      code: "config-duplicate-suite",
      subject: duplicate.name,
      line: duplicate.message,
      fix: textFix(
        `rename or remove one of the test suites named ${duplicate.name} in ${CONFIG_FILE}`,
      ),
    });
  }

  for (const setting of retiredSettingsIn(
    document,
    repository.publishedKeys(root),
  )) {
    problems.push({
      code: "config-retired",
      subject: setting.key,
      line: `config/${setting.key.replaceAll(".", "/")} is retired: ${setting.reason}`,
      fix: commandFix(
        withRepository(target, `recognizer config --unset ${setting.key}`),
      ),
    });
  }

  const cleaned = withoutEmptySections(
    withoutRetiredKeys(withoutFaultySensorSettings(document)),
  );
  const schema = repository.configSchemaMessages(cleaned);
  const messages = [
    ...duplicationFaultsIn(document).map((fault) => fault.message),
    ...schema,
    ...(schema.length === 0 && hasSuites(cleaned)
      ? unpublishedValuesIn(cleaned, repository.publishedKeys(root))
      : []),
  ];

  for (const message of messages) {
    problems.push({
      code: "config-invalid",
      subject: schemaSubject(message),
      line: message,
      fix: textFix(`correct ${schemaSubject(message)} in ${CONFIG_FILE}`),
    });
  }

  if (messages.length > 0) {
    return { problems, registered: { skipped: SKIP_CONFIG } };
  }

  const record = (cleaned ?? {}) as Record<string, unknown>;

  return { problems, registered: registeredFrom(registrations, record) };
}
