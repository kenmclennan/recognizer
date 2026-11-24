import {
  commandKey,
  type InstalledSensorEntry,
  type KeyEntry,
  type KeyOwners,
  notAnsweringLine,
  placeholderPattern,
  readInstalledSensors,
  readManifestCommand,
  readRegisteredSensors,
  type SectionEntry,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { parseConfig, registeredSensors } from "../../config-parse.js";
import { manifestPorts } from "../../manifest-ports.js";

interface Published {
  id: string;
  label: string;
  sensor: InstalledSensorEntry;
}

const SENSORS_OWNER = "sensors";

const DISPLAY_FIELDS = new Set([
  "label",
  "labels",
  "unit",
  "units",
  "order",
  "limit",
  "section",
  "scope",
  "switch",
]);

const PLACEHOLDER = /<([a-z][a-z0-9_]*)>/g;

function placeholdersIn(key: string): string[] {
  return [...key.matchAll(PLACEHOLDER)].map((found) => found[1] ?? "");
}

function keysOf(sensor: InstalledSensorEntry): string[] {
  const suite = sensor.suite_keys;

  return [
    ...(sensor.settings as KeyEntry[]).map((entry) => entry.key),
    ...(suite === undefined
      ? []
      : [
          (suite.section as SectionEntry).key,
          ...(suite.keys as KeyEntry[]).map((entry) => entry.key),
        ]),
  ];
}

function undisplayed(entry: KeyEntry): KeyEntry {
  return Object.fromEntries(
    Object.entries(entry).filter(([name]) => !DISPLAY_FIELDS.has(name)),
  ) as unknown as KeyEntry;
}

function sameEntry(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class KeyOwnersAdapter implements KeyOwners {
  constructor(private readonly io: Io) {}

  private registered(root: string) {
    const file = `${root.replace(/\/+$/, "")}/.recognizer/config.yaml`;
    const config = (() => {
      try {
        return this.io.exists(file)
          ? parseConfig(this.io.readFile(file), ["sensors"])
          : null;
      } catch {
        return null;
      }
    })();
    const sensors = registeredSensors(config);
    const read = readRegisteredSensors(sensors, (words) =>
      readManifestCommand(
        manifestPorts(this.io),
        words.map((word) => word.split("{repository}").join(root)),
      ),
    );

    return { sensors, read };
  }

  schemas(root?: string) {
    const path = readInstalledSensors(manifestPorts(this.io));
    const registered = root === undefined ? null : this.registered(root);
    const registeredNames = new Set(
      (registered?.sensors ?? [])
        .filter((one) => one.manifest !== undefined)
        .map((one) => one.name),
    );
    const published: Published[] = [
      ...path.sensors
        .filter((sensor) => !registeredNames.has(sensor.name))
        .map((sensor) => ({
          id: sensor.name,
          label: `recognizer-sense-${sensor.name}`,
          sensor,
        })),
      ...(registered?.sensors ?? []).flatMap((one) => {
        const sensor = registered?.read.entries[commandKey(one.command)];

        return sensor === undefined || one.manifest === undefined
          ? []
          : [{ id: one.name, label: `sensors.${one.name}`, sensor }];
      }),
    ];
    const installed = {
      sensors: published,
      unreadable: [
        ...path.unreadable
          .filter((one) => !registeredNames.has(one.name))
          .map((one) => ({
            label: `recognizer-sense-${one.name}`,
            reason: one.reason,
          })),
        ...(registered?.read.unreadable ?? []).map((one) => ({
          label: `sensors.${one.name}`,
          reason: one.reason,
        })),
      ],
    };
    const suiteKeys = new Map<string, KeyEntry>();
    const sections = new Map<string, SectionEntry>();
    const placeholders: Record<string, string> = {};
    const refused = new Set<string>();
    const conflicts: string[] = [];
    const answering = [...installed.sensors].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );

    const refuse = (item: Published, reason: string) => {
      refused.add(item.id);
      conflicts.push(notAnsweringLine(item.label, reason));
    };

    for (const item of answering) {
      const { sensor } = item;
      const reserved = (sensor.settings as KeyEntry[]).find(
        (entry) => entry.key === "manifest",
      );

      if (reserved !== undefined) {
        refuse(
          item,
          "its setting manifest is reserved for the manifest command",
        );

        continue;
      }

      const undeclared = keysOf(sensor).find((key) =>
        placeholdersIn(key).some(
          (name) => sensor.placeholders[name] === undefined,
        ),
      );

      if (undeclared !== undefined) {
        const name = placeholdersIn(undeclared).find(
          (one) => sensor.placeholders[one] === undefined,
        );

        refuse(
          item,
          `its key ${undeclared} uses the placeholder <${name}> that it does not declare`,
        );

        continue;
      }

      const patterns = Object.entries(sensor.placeholders).map(
        ([name, declaration]) =>
          [name, placeholderPattern(declaration)] as const,
      );
      const differing = patterns.find(
        ([name, pattern]) =>
          placeholders[name] !== undefined && placeholders[name] !== pattern,
      );

      if (differing !== undefined) {
        refuse(
          item,
          `its placeholder <${differing[0]}> is defined differently by another sensor`,
        );

        continue;
      }

      if (sensor.suite_keys !== undefined) {
        const section = sensor.suite_keys.section as SectionEntry;
        const entries = (sensor.suite_keys.keys as KeyEntry[]).map(undisplayed);
        const clash =
          (sections.has(section.key) &&
          !sameEntry(sections.get(section.key), section)
            ? section.key
            : undefined) ??
          entries.find(
            (entry) =>
              suiteKeys.has(entry.key) &&
              !sameEntry(suiteKeys.get(entry.key), entry),
          )?.key;

        if (clash !== undefined) {
          refuse(
            item,
            `its suite key ${clash} is defined differently by another sensor`,
          );

          continue;
        }

        sections.set(section.key, section);

        for (const entry of entries) {
          suiteKeys.set(entry.key, entry);
        }
      }

      for (const [name, pattern] of patterns) {
        placeholders[name] = pattern;
      }
    }

    const keys: KeyEntry[] = [...suiteKeys.values()];

    for (const { id, sensor } of installed.sensors) {
      if (refused.has(id)) {
        continue;
      }

      for (const entry of sensor.settings as KeyEntry[]) {
        const published = undisplayed(entry);

        keys.push({
          ...published,
          key: `sensors.${id}.${entry.key}`,
        });
      }
    }

    return {
      schema: {
        keys_version: 1 as const,
        owner: SENSORS_OWNER,
        placeholders,
        sections: [...sections.values()],
        keys,
      },
      notAnswering: [
        ...installed.unreadable.map((one) =>
          notAnsweringLine(one.label, one.reason),
        ),
        ...conflicts,
      ],
    };
  }
}
