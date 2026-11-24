import {
  type KeyEntry,
  type KeyOwners,
  notAnsweringLine,
  readShippedSensors,
  SUITE_KEYS,
  SUITE_SECTION,
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

export class KeyOwnersAdapter implements KeyOwners {
  constructor(private readonly io: Io) {}

  schemas() {
    const shipped = readShippedSensors(shippedPorts(this.io));
    const keys: KeyEntry[] = [...SUITE_KEYS];

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
        sections: [SUITE_SECTION],
        keys,
      },
      notAnswering: shipped.unreadable.map((one) =>
        notAnsweringLine(`recognizer-sense-${one.name}`, one.reason),
      ),
    };
  }
}
