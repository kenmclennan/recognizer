import type { CheckableSensor } from "../../domain/plugins/sensor-check.js";
import type { PluginPorts } from "./internal/plugin-ports.js";
import { selectSensors } from "./select-sensors.js";
import { readShippedSensors, shippedSensorOf } from "./shipped-plugins.js";

export function sensorsToCheck(
  ports: Pick<
    PluginPorts,
    "programs" | "validators" | "shipped" | "repository"
  >,
  root: string,
  name: string | undefined,
  withSuites = true,
): CheckableSensor[] {
  const registered = ports.repository.registeredSensors(root);
  const shipped = ports.shipped.sensors();
  const requested = name === undefined ? "all" : [name];

  if (!withSuites) {
    return selectSensors(registered, requested, shipped);
  }

  const wanted = new Set<string>(name === undefined ? [] : [name]);

  for (const one of registered) {
    const shippedName = shippedSensorOf(one.command, shipped);

    if (shippedName !== undefined) {
      wanted.add(shippedName);
    }
  }

  return selectSensors(
    registered,
    requested,
    shipped,
    ports.repository.suites(root),
    readShippedSensors(ports, undefined, [...wanted]),
  );
}
