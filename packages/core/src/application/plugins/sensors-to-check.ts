import type { CheckableSensor } from "../../domain/plugins/sensor-check.js";
import {
  installedSensorNames,
  readInstalledSensors,
  sensorNameOf,
} from "./installed-sensors.js";
import type { PluginPorts } from "./internal/plugin-ports.js";
import { selectSensors } from "./select-sensors.js";

export function sensorsToCheck(
  ports: Pick<PluginPorts, "programs" | "validators" | "repository">,
  root: string,
  name: string | undefined,
  withSuites = true,
): CheckableSensor[] {
  const registered = ports.repository.registeredSensors(root);
  const installed = installedSensorNames(ports);
  const requested = name === undefined ? "all" : [name];

  if (!withSuites) {
    return selectSensors(registered, requested, installed);
  }

  const wanted = new Set<string>(name === undefined ? [] : [name]);

  for (const one of registered) {
    const sensorName = sensorNameOf(one.command);

    if (sensorName !== undefined) {
      wanted.add(sensorName);
    }
  }

  return selectSensors(
    registered,
    requested,
    installed,
    ports.repository.suites(root),
    readInstalledSensors(ports, undefined, [...wanted]),
  );
}
