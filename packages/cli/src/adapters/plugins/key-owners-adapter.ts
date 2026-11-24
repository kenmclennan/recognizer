import {
  type InstalledSensorEntry,
  type KeyEntry,
  type KeyOwners,
  notAnsweringLine,
  placeholderPattern,
  readInstalledSensors,
  type SectionEntry,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { manifestPorts } from "../../manifest-ports.js";

const SENSORS_OWNER = "sensors";

const DISPLAY_FIELDS = new Set([
  "label",
  "labels",
  "unit",
  "units",
  "order",
  "limit",
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

function sameEntry(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class KeyOwnersAdapter implements KeyOwners {
  constructor(private readonly io: Io) {}

  schemas() {
    const installed = readInstalledSensors(manifestPorts(this.io));
    const suiteKeys = new Map<string, KeyEntry>();
    const sections = new Map<string, SectionEntry>();
    const placeholders: Record<string, string> = {};
    const refused = new Set<string>();
    const conflicts: string[] = [];
    const answering = [...installed.sensors].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );

    const refuse = (sensor: InstalledSensorEntry, reason: string) => {
      refused.add(sensor.name);
      conflicts.push(
        notAnsweringLine(`recognizer-sense-${sensor.name}`, reason),
      );
    };

    for (const sensor of answering) {
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
          sensor,
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
          sensor,
          `its placeholder <${differing[0]}> is defined differently by another sensor`,
        );

        continue;
      }

      if (sensor.suite_keys !== undefined) {
        const section = sensor.suite_keys.section as SectionEntry;
        const entries = sensor.suite_keys.keys as KeyEntry[];
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
            sensor,
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

    for (const sensor of installed.sensors) {
      if (refused.has(sensor.name)) {
        continue;
      }

      for (const entry of sensor.settings as KeyEntry[]) {
        const published = Object.fromEntries(
          Object.entries(entry).filter(([name]) => !DISPLAY_FIELDS.has(name)),
        ) as unknown as KeyEntry;

        keys.push({
          ...published,
          key: `sensors.${sensor.name}.${entry.key}`,
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
          notAnsweringLine(`recognizer-sense-${one.name}`, one.reason),
        ),
        ...conflicts,
      ],
    };
  }
}
