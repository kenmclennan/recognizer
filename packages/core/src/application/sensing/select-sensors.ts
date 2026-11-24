import {
  type InstalledRead,
  refuseUnregistered,
  sensorNameOf,
} from "../plugins/installed-sensors.js";
import { selectSensors as selectFrom } from "../plugins/select-sensors.js";
import type { SensingPorts } from "./internal/sensing-ports.js";
import type { SensorSelection, SensorSelectionInput } from "./ports/sensors.js";

export type { SensorSelection, SensorSelectionInput };

export function selectSensors(
  ports: SensingPorts,
  input: SensorSelectionInput,
): SensorSelection {
  const { sense, config, limits } = input;
  const installedNames = ports.catalog.installedNames();
  const registered = ports.config.registeredSensors(config);
  const requested: "all" | string[] =
    sense === "all" || sense === null ? "all" : sense.map((one) => one.name);
  let installed: InstalledRead = { sensors: [], unreadable: [] };
  let selected: { name: string; command: string[] }[] = [];

  if (sense !== null) {
    const wanted = new Set<string>(
      Array.isArray(requested)
        ? requested.filter((name) => installedNames.includes(name))
        : [],
    );

    for (const one of registered) {
      const name = sensorNameOf(one.command);

      if (name !== undefined) {
        wanted.add(name);
      }
    }

    installed = ports.catalog.readInstalled([...wanted], limits);
    selected = selectFrom(
      registered,
      requested,
      installedNames,
      ports.config.tests(config),
      installed,
    );
  }

  refuseUnregistered(
    registered.map((one) => one.name),
    Array.isArray(requested) && sense !== null ? requested : [],
    installedNames,
  );

  return { selected, installed };
}
