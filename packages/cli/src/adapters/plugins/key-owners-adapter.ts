import {
  type KeyEntry,
  type KeyOwners,
  notAnsweringLine,
  readShippedSensors,
  type SectionEntry,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { shippedPorts } from "../../manifest-ports.js";

const SENSORS_OWNER = "sensors";

const DISPLAY_FIELDS = new Set([
  "label",
  "labels",
  "unit",
  "units",
  "order",
  "limit",
]);

const SENSOR_PLACEHOLDERS: Record<string, string> = {
  name: "^.+$",
  variable: "^[A-Za-z_][A-Za-z0-9_]*$",
  metric: "^(?!command$)[A-Za-z0-9_-]+$",
};

function sameEntry(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class KeyOwnersAdapter implements KeyOwners {
  constructor(private readonly io: Io) {}

  schemas() {
    const shipped = readShippedSensors(shippedPorts(this.io));
    const suiteKeys = new Map<string, KeyEntry>();
    const sections = new Map<string, SectionEntry>();
    const conflicts: string[] = [];
    const answering = [...shipped.sensors].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );

    for (const sensor of answering) {
      if (sensor.suite_keys === undefined) {
        continue;
      }

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
        conflicts.push(
          notAnsweringLine(
            `recognizer-sense-${sensor.name}`,
            `its suite key ${clash} is defined differently by another sensor`,
          ),
        );

        continue;
      }

      sections.set(section.key, section);

      for (const entry of entries) {
        suiteKeys.set(entry.key, entry);
      }
    }

    const keys: KeyEntry[] = [...suiteKeys.values()];

    for (const sensor of shipped.sensors) {
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
        placeholders: SENSOR_PLACEHOLDERS,
        sections: [...sections.values()],
        keys,
      },
      notAnswering: [
        ...shipped.unreadable.map((one) =>
          notAnsweringLine(`recognizer-sense-${one.name}`, one.reason),
        ),
        ...conflicts,
      ],
    };
  }
}
