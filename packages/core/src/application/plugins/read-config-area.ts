import {
  commandFix,
  textFix,
  withRepository,
} from "../../domain/plugins/doctor-commands.js";
import {
  type ConfigRegistration,
  type Found,
  kindOfProgram,
  type PluginSpec,
  type RegisteredPlugins,
} from "../../domain/plugins/doctor-report.js";
import { PREFIXES } from "../../domain/plugins/installed-plugin.js";
import { manifestFix } from "../../domain/plugins/undeclared-sensors.js";
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
import type { RepositoryChecks } from "./ports/repository-checks.js";
import {
  type ExpandedConfig,
  expandedConfigOf,
  registeredSensors,
} from "./registered-sensors.js";

export interface ConfigReading {
  problems: Found[];
  registered: ConfigRegistration;
}

const NONE: RegisteredPlugins = {
  specs: [],
  named: {},
  install: {},
  sensors: [],
  describer: false,
};

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

function settingsOf(
  command: string[],
  manifest: string[],
): Record<string, unknown> | null {
  const at = command.indexOf("--settings");
  const text = at === -1 ? undefined : command[at + 1];

  if (text === undefined || manifest.length === 0) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);

    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function specsOf(
  config: ExpandedConfig,
  install: Record<string, string>,
): PluginSpec[] {
  const specs: PluginSpec[] = [];

  for (const sensor of registeredSensors(config)) {
    if (sensor.manifest !== undefined) {
      const run = sensor.command[0] as string;
      const program = sensor.manifest[0] as string;

      specs.push({
        kind: "sensor",
        subject: sensor.name,
        name:
          kindOfProgram(run) === "sensor"
            ? run.slice(PREFIXES.sensor.length)
            : sensor.name,
        program,
        command: sensor.command,
        manifest: sensor.manifest,
        settings: settingsOf(sensor.command, sensor.manifest),
        installLine: install[program] ?? null,
      });
    }
  }

  const program = config.describer?.command[0];

  if (program !== undefined && kindOfProgram(program) === "describer") {
    specs.push({
      kind: "describer",
      subject: "describer",
      name: program.slice(PREFIXES.describer.length),
      program,
      command: config.describer?.command ?? [program],
      settings: null,
      installLine: install[program] ?? null,
    });
  }

  return specs;
}

export function readConfigArea(
  repository: RepositoryChecks,
  root: string,
  named: boolean,
): ConfigReading {
  const target = { repository: root, named };
  const read = repository.configDocument(root);

  if (read.kind === "absent") {
    return { problems: [], registered: NONE };
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
  const install = stringMap(record.install);
  const expanded = expandedConfigOf(cleaned) as ExpandedConfig;

  for (const sensor of registeredSensors(expanded)) {
    if (
      sensor.manifest === undefined &&
      kindOfProgram(sensor.command[0] as string) === "sensor"
    ) {
      const fix = manifestFix(sensor.name, sensor.command)
        .split(" && ")
        .map((command) => withRepository(target, command))
        .join(" && ");

      problems.push({
        code: "sensor-manifest-missing",
        subject: sensor.name,
        line: `sensors.${sensor.name} names no manifest command, so it declares nothing (no suites, no scope, no check)`,
        fix: commandFix(fix),
      });
    }
  }

  return {
    problems,
    registered: {
      specs: specsOf(expanded, install),
      named: stringMap(record.scanners),
      install,
      sensors: registeredSensors(expanded).map((one) => one.name),
      describer: record.describer !== undefined,
    },
  };
}
