import type { CheckableSensor } from "../../domain/plugins/sensor-check.js";
import {
  installedSensorNames,
  readRegisteredSensors,
  withRegistered,
} from "./installed-sensors.js";
import type { PluginPorts } from "./internal/plugin-ports.js";
import { readManifestCommand } from "./read-manifest.js";
import { selectSensors } from "./select-sensors.js";

export function sensorsToCheck(
  ports: Pick<
    PluginPorts,
    "programs" | "validators" | "repository" | "registrations"
  >,
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

  const chosen = selectSensors(registered, requested, installed);
  const read = withRegistered(
    { sensors: [], unreadable: [] },
    readRegisteredSensors(chosen, (words) => readManifestCommand(ports, words)),
  );

  return selectSensors(
    registered,
    requested,
    installed,
    ports.repository.suites(root),
    read,
  );
}
