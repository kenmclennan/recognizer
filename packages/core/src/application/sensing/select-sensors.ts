import { selectSensors as selectFrom } from "../plugins/select-sensors.js";
import {
  refuseUnregistered,
  type ShippedRead,
  shippedSensorOf,
} from "../plugins/shipped-plugins.js";
import type { SensingPorts } from "./internal/sensing-ports.js";
import type { SensorSelection, SensorSelectionInput } from "./ports/sensors.js";

export type { SensorSelection, SensorSelectionInput };

export function selectSensors(
  ports: SensingPorts,
  input: SensorSelectionInput,
): SensorSelection {
  const { sense, config, limits } = input;
  const shippedNames = ports.catalog.shippedNames();
  const registered = ports.config.registeredSensors(config);
  const requested: "all" | string[] =
    sense === "all" || sense === null ? "all" : sense.map((one) => one.name);
  let shipped: ShippedRead = { sensors: [], unreadable: [] };
  let selected: { name: string; command: string[] }[] = [];

  if (sense !== null) {
    const wanted = new Set<string>(
      Array.isArray(requested)
        ? requested.filter((name) => shippedNames.includes(name))
        : [],
    );

    for (const one of registered) {
      const name = shippedSensorOf(one.command, shippedNames);

      if (name !== undefined) {
        wanted.add(name);
      }
    }

    shipped = ports.catalog.readShipped([...wanted], limits);
    selected = selectFrom(
      registered,
      requested,
      shippedNames,
      ports.config.tests(config),
      shipped,
    );
  }

  refuseUnregistered(
    registered.map((one) => one.name),
    Array.isArray(requested) && sense !== null ? requested : [],
    shippedNames,
  );

  return { selected, shipped };
}
